// 检查图片签名、块边界和尺寸；下载时仍强制 MIME、nosniff 和 sandbox。
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function webpFrame(data, start, length, kind) {
  if (kind === 'VP8 ' && length >= 10 && data.subarray(start + 3, start + 6).equals(Buffer.from([157, 1, 42]))) {
    return [data.readUInt16LE(start + 6) & 16383, data.readUInt16LE(start + 8) & 16383]
  }
  if (kind === 'VP8L' && length >= 5 && data[start] === 47) {
    const bits = data.readUInt32LE(start + 1)
    if (bits >>> 29) return null // 当前无损格式的版本号必须为0。
    return [1 + (bits & 16383), 1 + ((bits >>> 14) & 16383)]
  }
  return null
}
function imageType(data) {
  if (!Buffer.isBuffer(data) || data.length < 24) return null
  let width = 0; let height = 0; let mime = ''
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    let pos = 8; let ihdr = false; let idat = false; let end = false
    while (pos + 12 <= data.length) {
      const len = data.readUInt32BE(pos); const type = data.toString('ascii', pos + 4, pos + 8)
      if (pos + len + 12 > data.length || crc32(data.subarray(pos + 4, pos + 8 + len)) !== data.readUInt32BE(pos + 8 + len)) return null
      if (!ihdr) {
        if (type !== 'IHDR' || len !== 13) return null
        width = data.readUInt32BE(pos + 8); height = data.readUInt32BE(pos + 12); ihdr = true
        const depths = { 0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16] }
        if (!depths[data[pos + 17]]?.includes(data[pos + 16]) || data[pos + 18] !== 0 || data[pos + 19] !== 0 || data[pos + 20] > 1) return null
      } else if (type === 'IHDR') return null
      if (type === 'IDAT' && len > 0) idat = true
      pos += len + 12
      if (type === 'IEND') { end = len === 0 && pos === data.length; break }
    }
    if (!ihdr || !idat || !end) return null
    mime = 'image/png'
  } else if (data[0] === 255 && data[1] === 216 && data[data.length - 2] === 255 && data[data.length - 1] === 217) {
    let pos = 2; let scan = false
    while (pos + 4 <= data.length - 2) {
      if (data[pos++] !== 255) return null
      while (pos < data.length - 2 && data[pos] === 255) pos++
      // 标记填充字节可能延伸到文件尾；读取长度前重新检查边界。
      if (pos + 3 > data.length - 2) return null
      const marker = data[pos++]
      const len = data.readUInt16BE(pos)
      if (len < 2 || pos + len > data.length - 2) return null
      if (marker === 218) {
        if (len < 6 || !data[pos + 2] || pos + len >= data.length - 2 || len !== 6 + 2 * data[pos + 2]) return null
        scan = true; break
      }
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (len < 8 || !data[pos + 7] || len !== 8 + 3 * data[pos + 7]) return null
        height = data.readUInt16BE(pos + 3); width = data.readUInt16BE(pos + 5)
      }
      pos += len
    }
    if (!scan) return null
    mime = 'image/jpeg'
  } else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' && data.readUInt32LE(4) + 8 === data.length) {
    let pos = 12; let frame = false; let canvas = false; let animated = false
    while (pos + 8 <= data.length) {
      const kind = data.toString('ascii', pos, pos + 4); const len = data.readUInt32LE(pos + 4)
      const start = pos + 8; const end = start + len; const next = end + (len & 1)
      if (next > data.length) return null
      if (kind === 'VP8X') {
        if (pos !== 12 || len !== 10) return null
        width = 1 + data.readUIntLE(start + 4, 3); height = 1 + data.readUIntLE(start + 7, 3); canvas = true
        animated = Boolean(data[start] & 2)
      } else if (kind === 'VP8 ' || kind === 'VP8L') {
        const dimensions = webpFrame(data, start, len, kind)
        if (!dimensions || frame || animated) return null
        if (canvas && (width !== dimensions[0] || height !== dimensions[1])) return null
        width = dimensions[0]; height = dimensions[1]; frame = true
      } else if (kind === 'ANMF') {
        if (!canvas || !animated || len < 16) return null
        const x = 2 * data.readUIntLE(start, 3); const y = 2 * data.readUIntLE(start + 3, 3)
        const w = 1 + data.readUIntLE(start + 6, 3); const h = 1 + data.readUIntLE(start + 9, 3)
        if (x + w > width || y + h > height) return null
        let sub = start + 16; let nestedFrame = false
        while (sub + 8 <= end) {
          const type = data.toString('ascii', sub, sub + 4); const size = data.readUInt32LE(sub + 4)
          const bound = sub + 8 + size + (size & 1)
          if (bound > end) return null
          if (type === 'VP8 ' || type === 'VP8L') {
            const dimensions = webpFrame(data, sub + 8, size, type)
            if (nestedFrame || !dimensions || dimensions[0] !== w || dimensions[1] !== h) return null
            nestedFrame = true
          }
          sub = bound
        }
        if (!nestedFrame || sub !== end) return null
        frame = true
      }
      pos = next
    }
    if (!frame || pos !== data.length) return null
    mime = 'image/webp'
  }
  if (!mime || width < 1 || height < 1 || width * height > 40000000) return null
  return mime
}
module.exports = { imageType }
