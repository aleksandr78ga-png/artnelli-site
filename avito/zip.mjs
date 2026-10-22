// Small dependency-free ZIP (stored entries, UTF-8 names). PNG files are already compressed.
const encoder = new TextEncoder();
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipBlob(files) {
  const chunks = [], central = [];
  let offset = 0, centralSize = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const bytes = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + name.length), v = new DataView(local.buffer);
    v.setUint32(0,0x04034b50,true); v.setUint16(4,20,true); v.setUint16(6,0x800,true);
    v.setUint16(12,33,true); v.setUint32(14,crc,true); v.setUint32(18,bytes.length,true);
    v.setUint32(22,bytes.length,true); v.setUint16(26,name.length,true); local.set(name,30);
    chunks.push(local,bytes);
    const c = new Uint8Array(46 + name.length), d = new DataView(c.buffer);
    d.setUint32(0,0x02014b50,true); d.setUint16(4,20,true); d.setUint16(6,20,true);
    d.setUint16(8,0x800,true); d.setUint16(14,33,true); d.setUint32(16,crc,true);
    d.setUint32(20,bytes.length,true); d.setUint32(24,bytes.length,true);
    d.setUint16(28,name.length,true); d.setUint32(42,offset,true); c.set(name,46);
    central.push(c); centralSize += c.length; offset += local.length + bytes.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true);
  e.setUint32(12,centralSize,true); e.setUint32(16,offset,true);
  return new Blob([...chunks,...central,end],{type:'application/zip'});
}
