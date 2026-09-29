import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

from PIL import Image

spec = importlib.util.spec_from_file_location("vk_feed", Path(__file__).with_name("build-vk-feed.py"))
feed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feed)


class FeedTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.site = Path(self.tmp.name)
        (self.site / "assets/catalog").mkdir(parents=True)
        self.image = self.site / "assets/catalog/test.webp"
        Image.new("RGB", (480, 640), "blue").save(self.image)

    def product(self, product_id=1, **values):
        return {"id": product_id, "name": "Свет & <b>сила</b>", "condition": "new",
                "prices": [86900], "photos": ["assets/catalog/test.webp"],
                "telegram": "https://t.me/nelli_leotards/112/1", "height": "145–155",
                "specs": {"girth": "123–133"},
                "description": "Стоимость 86.900 рублей. Телефон продавца +7 000 111 22 33, адрес клиента", **values}

    def catalog(self, products):
        (self.site / "catalog-data.js").write_text("window.NELLI_CATALOG = " + json.dumps(products) + ";\n")

    def test_prices_privacy_rental_and_jpeg(self):
        self.catalog([self.product(), self.product(2, prices=[], description="Цена по запросу"),
                      self.product(3, prices=[1, 2]), self.product(4, condition="rental", prices=[4500], description="Аренда 4 500 ₽"),
                      self.product(5, sold=True), self.product(6, condition="used", prices=[1234.50], description="Цена 1 234,50 руб."),
                      self.product(7, prices=[0]), self.product(8, prices=[True]),
                      self.product(9, description="Стоимость 86.900 рублей 80.000 рублей"),
                      self.product(10, description="Price 86900 USD")])
        report = feed.build(self.site)
        root = ET.parse(self.site / "feeds/vk.yml")
        offers = root.findall("./shop/offers/offer")
        self.assertEqual([o.get("id") for o in offers], ["artnelli-1", "artnelli-4", "artnelli-6"])
        self.assertEqual(offers[0].findtext("price"), "86900")
        self.assertEqual(offers[2].findtext("price"), "1234.5")
        self.assertEqual(offers[0].findtext("name"), "Свет & сила")
        self.assertEqual(offers[1].findtext("categoryId"), "3")
        self.assertIn("Аренда", offers[1].findtext("name"))
        self.assertIn("стоимость аренды", offers[1].findtext("description"))
        self.assertIn("Дуга тела: 123–133 см", offers[0].findtext("description"))
        xml = (self.site / "feeds/vk.yml").read_text()
        self.assertNotIn("000 111", xml)
        self.assertNotIn("адрес клиента", xml)
        self.assertTrue(report["do_not_delete_missing_products"])
        self.assertEqual(len(report["skipped"]), 7)
        self.assertEqual(report["price_on_request_count"], 1)
        self.assertEqual(report["offer_variants_require_mapping_count"], 2)
        pending = json.loads((self.site / "feeds/vk-pending.json").read_text())["offers"]
        self.assertEqual(pending[0]["price_label"], "Цена по запросу")
        self.assertEqual(pending[0]["prices_rub"], [])
        self.assertEqual(pending[0]["price_status"], "price_on_request")
        for picture in self.site.glob("feeds/vk-images/*"):
            with Image.open(picture) as image:
                self.assertEqual(image.format, "JPEG")
                self.assertEqual(image.size, (480, 640))

    def test_stable_output_and_updated_photo(self):
        self.catalog([self.product()])
        feed.build(self.site)
        before = (self.site / "feeds/vk.yml").read_bytes()
        report_before = (self.site / "feeds/vk-report.json").read_bytes()
        feed.build(self.site)
        self.assertEqual(before, (self.site / "feeds/vk.yml").read_bytes())
        self.assertEqual(report_before, (self.site / "feeds/vk-report.json").read_bytes())
        Image.new("RGB", (480, 640), "red").save(self.image)
        feed.build(self.site)
        self.assertNotEqual(before, (self.site / "feeds/vk.yml").read_bytes())
        self.assertEqual(len(list(self.site.glob("feeds/vk-images/*.jpg"))), 2)

    def test_invalid_source_preserves_previous_feed(self):
        self.catalog([self.product()])
        feed.build(self.site)
        previous = (self.site / "feeds/vk.yml").read_bytes()
        for products in [[], [self.product(), self.product()], [self.product(prices=[])],
                         [self.product(photos=["assets/catalog/../../../outside.png"])]]:
            self.catalog(products)
            with self.assertRaises(ValueError):
                feed.build(self.site)
            self.assertEqual(previous, (self.site / "feeds/vk.yml").read_bytes())


if __name__ == "__main__":
    unittest.main()
