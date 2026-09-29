#!/usr/bin/env python3
"""Build a public YML export. Does not connect to or mutate VK."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from decimal import Decimal
import xml.etree.ElementTree as ET

from PIL import Image, ImageOps

BASE_URL = "https://artnelli.com/"
CATEGORIES = {"new": ("1", "Новые купальники"),
              "used": ("2", "Купальники б/у"),
              "rental": ("3", "Аренда купальников")}
SPEC_LABELS = {"chest": "Обхват груди", "waist": "Обхват талии",
               "hips": "Обхват бёдер", "girth": "Дуга тела"}


def plain(value):
    # YML must contain plain text, including when upstream data has HTML.
    value = re.sub(r"<[^>]*>", "", str(value or ""))
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]", "", value).strip()


def read_catalog(site):
    source = (site / "catalog-data.js").read_text(encoding="utf-8")
    match = re.fullmatch(r"\s*window\.NELLI_CATALOG\s*=\s*(\[.*\])\s*;?\s*", source, re.S)
    if not match:
        raise ValueError("Unrecognised catalogue format")
    products = json.loads(match[1])
    if not products or not all(isinstance(p, dict) for p in products):
        raise ValueError("Empty or malformed catalogue; refusing to publish")
    return products


def rub_prices(text):
    amounts = re.findall(r"(?<![\d.,])((?:\d{1,3}(?:[ .\u00a0\u202f]\d{3})+|\d+)(?:[,.]\d{1,2})?)\s*(?:₽|руб(?:лей|ля|ль)?\b|RUB\b)", str(text or ""), re.I)
    values = set()
    for amount in amounts:
        amount = re.sub(r"[ \u00a0\u202f]", "", amount)
        amount = re.sub(r"\.(?=\d{3}(?:\D|$))", "", amount).replace(",", ".")
        values.add(Decimal(amount))
    return values


def picture(site, relative):
    if not isinstance(relative, str) or not relative.startswith("assets/catalog/"):
        raise ValueError("image_path_not_local")
    source = (site / relative).resolve()
    if not source.is_relative_to((site / "assets/catalog").resolve()):
        raise ValueError("image_path_not_local")
    data = source.read_bytes()
    with Image.open(source) as original:
        if getattr(original, "is_animated", False):
            raise ValueError("animated_image")
        im = ImageOps.exif_transpose(original)
        width, height = im.size
        if min(width, height) < 400 or max(width, height) / min(width, height) > 20:
            raise ValueError("image_dimensions")
        # Re-encode without EXIF/location data. Keep the full frame and resolution.
        digest = hashlib.sha256(b"vk-jpeg-v1\0" + data).hexdigest()[:24]
        target = site / "feeds/vk-images" / (digest + ".jpg")
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            if "A" in im.getbands() or "transparency" in im.info:
                rgba = im.convert("RGBA")
                rgb = Image.new("RGB", rgba.size, "white")
                rgb.paste(rgba, mask=rgba.getchannel("A"))
            else:
                rgb = im.convert("RGB")
            temporary = target.with_suffix(".tmp")
            rgb.save(temporary, format="JPEG", quality=94, subsampling=0, optimize=True)
            temporary.replace(target)
    return BASE_URL + target.relative_to(site).as_posix()


def description(product):
    condition = product["condition"]
    lines = [plain(product["name"]), CATEGORIES[condition][1]]
    if product.get("height"):
        lines.append("Рост: " + plain(product["height"]) + " см")
    for key, label in SPEC_LABELS.items():
        value = (product.get("specs") or {}).get(key)
        if value:
            lines.append(label + ": " + plain(value) + " см")
    if condition == "rental":
        lines.append("Указана стоимость аренды. Срок и условия уточняйте перед бронированием.")
    # Do not copy seller phone numbers, names, or addresses from free-form posts.
    # The original listing remains available for full product and seller details.
    source = str(product.get("telegram") or "")
    if re.fullmatch(r"https://t\.me/nelli_leotards/(?:\d+/)?\d+", source):
        lines.append("Подробности в исходном объявлении: " + source)
    return "\n".join(lines)


def add(parent, tag, value, **attributes):
    node = ET.SubElement(parent, tag, attributes)
    node.text = str(value)
    return node


def write_if_changed(path, data):
    if path.exists() and path.read_bytes() == data:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def build(site):
    site = Path(site).resolve()
    products = read_catalog(site)
    shop = ET.Element("shop")
    add(shop, "name", "Leotards by Nelli")
    add(shop, "company", "Leotards by Nelli")
    add(shop, "url", BASE_URL)
    currencies = ET.SubElement(shop, "currencies")
    ET.SubElement(currencies, "currency", {"id": "RUB", "rate": "1"})
    categories = ET.SubElement(shop, "categories")
    for category_id, label in CATEGORIES.values():
        add(categories, "category", label, id=category_id)
    offers = ET.SubElement(shop, "offers")
    skipped, image_warnings, seen = [], [], set()
    for product in products:
        product_id = product.get("id")
        if isinstance(product_id, bool) or not isinstance(product_id, int) or product_id <= 0:
            skipped.append({"id": product_id, "reason": "unverified_source_id"})
            continue
        if product_id in seen:
            raise ValueError(f"Duplicate source id {product_id}; refusing to publish")
        seen.add(product_id)
        reason = None
        prices = product.get("prices")
        if product.get("removed") is True or product.get("sold") is True or product.get("available") is False:
            reason = "not_available"
        elif product.get("condition") not in CATEGORIES:
            reason = "unknown_offer_type"
        elif not plain(product.get("name")):
            reason = "missing_name"
        elif not isinstance(prices, list) or not prices:
            reason = "missing_price"
        elif len(prices) != 1:
            reason = "ambiguous_price"
        elif isinstance(prices[0], bool) or not isinstance(prices[0], (int, float)) or not (0 < prices[0] < 10**9) or round(prices[0], 2) != prices[0]:
            reason = "invalid_price"
        else:
            declared = rub_prices(product.get("description"))
            if not declared:
                reason = "unverified_rub_price"
            elif declared != {Decimal(str(prices[0]))}:
                reason = "source_price_conflict"
        if reason:
            skipped.append({"id": product_id, "name": plain(product.get("name")), "reason": reason})
            continue
        pictures = []
        for relative in product.get("photos") or []:
            try:
                url = picture(site, relative)
                if url not in pictures:
                    pictures.append(url)
            except (OSError, ValueError, Image.DecompressionBombError) as error:
                image_warnings.append({"id": product_id, "image": relative, "reason": type(error).__name__ + ": " + str(error)})
        if not pictures:
            skipped.append({"id": product_id, "name": plain(product.get("name")), "reason": "no_valid_images"})
            continue
        offer = ET.SubElement(offers, "offer", {"id": f"artnelli-{product_id}", "available": "true"})
        add(offer, "url", BASE_URL + "telegram/?product=" + str(product_id))
        add(offer, "price", format(prices[0], ".2f").rstrip("0").rstrip("."))
        add(offer, "currencyId", "RUB")
        add(offer, "categoryId", CATEGORIES[product["condition"]][0])
        for url in pictures:
            add(offer, "picture", url)
        name = plain(product["name"])
        if product["condition"] == "rental":
            name = "Аренда — " + name
        elif product["condition"] == "used":
            name = "Б/у — " + name
        add(offer, "name", name)
        add(offer, "vendor", "Leotards by Nelli")
        add(offer, "description", description(product))
    if not 0 < len(offers) <= 15000:
        raise ValueError("No exportable products or catalogue exceeds VK limit; refusing to publish")
    report = {"scope": "source_export_only", "vk_sync_configured": False,
              "do_not_delete_missing_products": True,
              "source_count": len(products), "offer_count": len(offers),
              "skipped": skipped, "image_warnings": image_warnings}
    fingerprint = hashlib.sha256(ET.tostring(shop) + json.dumps(report, sort_keys=True).encode()).hexdigest()
    previous_path = site / "feeds/vk-report.json"
    previous = json.loads(previous_path.read_text()) if previous_path.exists() else {}
    generated_at = previous.get("generated_at") if previous.get("fingerprint") == fingerprint else None
    generated_at = generated_at or datetime.now(timezone.utc).isoformat(timespec="seconds")
    report.update(fingerprint=fingerprint, generated_at=generated_at)
    catalog = ET.Element("yml_catalog", {"date": datetime.fromisoformat(generated_at).strftime("%Y-%m-%d %H:%M")})
    catalog.append(shop)
    ET.indent(catalog, space="  ")
    xml = ET.tostring(catalog, encoding="utf-8", xml_declaration=True) + b"\n"
    if len(xml) > 8_000_000:
        raise ValueError("YML exceeds 8 MB; refusing to publish")
    ET.fromstring(xml)
    write_if_changed(site / "feeds/vk.yml", xml)
    write_if_changed(previous_path, (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode())
    print(f"VK source export: {len(offers)}/{len(products)} offers, {len(skipped)} skipped, {len(image_warnings)} image warnings. VK is not connected.")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-dir", type=Path, default=Path(__file__).resolve().parent.parent / "site")
    build(parser.parse_args().site_dir)
