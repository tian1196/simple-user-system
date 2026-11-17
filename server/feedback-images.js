// 只接受图片二进制签名和有效的尺寸/容器结构，下载时仍强制 MIME、nosniff 和 sandbox。
function imageType(data) {
  if (!Buffer.isBuffer(data) || data.length < 24) return null
  let width = 0; let height = 0; let mime = ''
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    let pos = 8; let ihdr = false; let idat = false; let end = false
    while (pos + 12 <= data.length) {
      const len = data.readUInt32BE(pos); const type = data.toString('ascii', pos + 4, pos + 8)
      if (pos + len + 12 > data.length) return null
      if (!ihdr) {
        if (type !== 'IHDR' || len !== 13) return null
        width = data.readUInt32BE(pos + 8); height = data.readUInt32BE(pos + 12); ihdr = true
      }
      if (type === 'IDAT' && len > 0) idat = true
      pos += len + 12
      if (type === 'IEND') { end = len === 0 && pos === data.length; break }
    }
    if (!ihdr || !idat || !end) return null
    mime = 'image/png'
  } else if (data[0] === 255 && data[1] === 216 && data[data.length - 2] === 255 && data[data.length - 1] === 217) {
    let pos = 2; let scan = false
    while (pos + 4 <= data.length) {
      if (data[pos++] !== 255) return null
      while (data[pos] === 255) pos++
      const marker = data[pos++]
      if (marker === 218) { scan = true; break }
      const len = data.readUInt16BE(pos)
      if (len < 2 || pos + len > data.length) return null
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (len < 8) return null
        height = data.readUInt16BE(pos + 3); width = data.readUInt16BE(pos + 5)
      }
      pos += len
    }
    if (!scan) return null
    mime = 'image/jpeg'
  } else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' && data.readUInt32LE(4) + 8 === data.length) {
    const kind = data.toString('ascii', 12, 16)
    if (data.readUInt32LE(16) + 20 > data.length) return null
    if (kind === 'VP8X' && data.length >= 30) {
      width = 1 + data.readUIntLE(24, 3); height = 1 + data.readUIntLE(27, 3)
      if (!data.includes(Buffer.from('VP8 ', 'ascii'), 30) && !data.includes(Buffer.from('VP8L', 'ascii'), 30)) return null
    } else if (kind === 'VP8 ' && data.length >= 30 && data.subarray(23,26).equals(Buffer.from([157,1,42]))) {
      width = data.readUInt16LE(26) & 16383; height = data.readUInt16LE(28) & 16383
    } else if (kind === 'VP8L' && data.length >= 25 && data[20] === 47) {
      const bits = data.readUInt32LE(21); width = 1 + (bits & 16383); height = 1 + ((bits >>> 14) & 16383)
    } else return null
    mime = 'image/webp'
  }
  if (!mime || width < 1 || height < 1 || width * height > 40000000) return null
  return mime
}
module.exports = { imageType }
