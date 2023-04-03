import https from 'https'

import http2 from 'http2'
import { URL } from 'url'
import zlib from 'zlib'

function nodelink_generateSessionId() {
  let result = ''
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const charactersLength = characters.length
  
  let counter = 0
  while (counter < 16) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
    counter += 1
  }
  
  return result
}

function nodelink_http1makeRequest(url, options) {
  return new Promise(async (resolve) => {
    let compression, data = ''
    console.log(url)

    https.request(url, {
      method: options.method,
      headers: {
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/111.0'
      }
    }, (res) => {
      switch (res.headers['content-encoding']) {
        case 'deflate': {
          compression = zlib.createInflate()
          break
        }
        case 'br': {
          compression = zlib.createBrotliDecompress()
          break
        }
        case 'gzip': {
          compression = zlib.createGunzip()
          break
        }
        default: {
          console.log('[NodeLink]: No compression detected, skipping...')
        }
      }

      if (compression) {
        res.pipe(compression)
        res = compression
      }

      res.on('data', (chunk) => (data += chunk))

      res.on('end', () => resolve(JSON.parse(data.toString())))

      res.on('error', (error) => {
        throw new Error(`Failed sending HTTP request: ${error}`)
      })
    }).end()
  })
}

function nodelink_makeRequest(url, options) {
  return new Promise(async (resolve) => {
    let compression, data = '', parsedUrl = new URL(url)

    if (!options) options = {}

    const client = http2.connect(parsedUrl.origin, { protocol: parsedUrl.protocol })

    let req = client.request({
      ':method': options.method,
      ':path': parsedUrl.pathname + parsedUrl.search,
      'Accept-Encoding': 'gzip, deflate, br',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/111.0',
      [options.body ? 'Content-Encoding' : '']: 'gzip',
      ...(options.headers ? options.headers : {})
    })

    req.on('response', (headers) => {
      switch (headers['content-encoding']) {
        case 'deflate': {
          compression = zlib.createInflate()
          break
        }
        case 'br': {
          compression = zlib.createBrotliDecompress()
          break
        }
        case 'gzip': {
          compression = zlib.createGunzip()
          break
        }
        default: {
          console.log('[NodeLink]: No compression detected, skipping...')
        }
      }

      if (compression) {
        req.pipe(compression)
        req = compression
      }

      req.on('data', (chunk) => (data += chunk))

      req.on('end', () => {
        if (url == 'https://clienttoken.spotify.com/v1/clienttoken' || url.startsWith('https://api-partner.spotify.com')) resolve(data.toString())
        else resolve(headers['content-type'].startsWith('application/json') ? JSON.parse(data.toString()) : data.toString())

        client.close()
      })

      req.on('error', (error) => {
        console.log(error, url)
        throw new Error(`Failed sending HTTP request: ${error}`)
      })
    })

    if (options.body) {
      zlib.gzip(JSON.stringify(options.body), (error, data) => {
        if (error) throw new Error(`Failed sending HTTP request: ${error}`)
        req.write(data, () => req.end())
      })
    }
    else req.end()
  })
}

class EncodeClass {
  constructor() {
    this.position = 0
    this.buffer = Buffer.alloc(256)
  }

  changeBytes(bytes) {
    if (this.position + bytes > 252) {
      const newBuffer = Buffer.alloc(Math.max(this.buffer.length * 2, this.position + bytes))
      this.buffer.copy(newBuffer)
      this.buffer = newBuffer
    }
    this.position += bytes
    return this.position - bytes
  }

  write(type, value) {
    switch (type) {
      case 'byte': {
        this.buffer[this.changeBytes(1)] = value
        break
      }
      case 'unsignedShort': {
        this.buffer.writeUInt16BE(value, this.changeBytes(2))
        break
      }
      case 'int': {
        this.buffer.writeInt32BE(value, this.changeBytes(4))
        break
      }
      case 'long': {
        const msb = value / BigInt(2 ** 32)
        const lsb = value % BigInt(2 ** 32)

        this.write('int', Number(msb))
        this.write('int', Number(lsb))
        break
      }
      case 'utf': {
        const len = Buffer.byteLength(value, 'utf8')
        this.write('unsignedShort', len)
        const start = this.changeBytes(len)
        this.buffer.write(value, start, len, 'utf8')
        break
      }
      default: {
        throw new Error(`Unknown type ${type}, please report that.`)
      }
    }
  }

  result() {
    return this.buffer.slice(0, this.position)
  }
}

function nodelink_encodeTrack(obj) {
  const buf = new EncodeClass()

  buf.write('byte', 3)
  buf.write('utf', obj.title)
  buf.write('utf', obj.author)
  buf.write('long', BigInt(obj.length))
  buf.write('utf', obj.identifier)
  buf.write('byte', obj.isStream ? 1 : 0)
  buf.write('byte', obj.uri ? 1 : 0)
  if (obj.uri) buf.write('utf', obj.uri)
  buf.write('byte', obj.artworkUrl ? 1 : 0)
  if (obj.artworkUrl) buf.write('utf', obj.artworkUrl)
  buf.write('byte', obj.isrc ? 1 : 0)
  if (obj.isrc) buf.write('utf', obj.isrc)
  buf.write('utf', obj.sourceName)
  buf.write('long', BigInt(obj.position))

  const buffer = buf.result()
  const result = Buffer.alloc(buffer.length + 4)

  result.writeInt32BE(buffer.length | (1 << 30))
  buffer.copy(result, 4)

  return result.toString('base64')
}

class DecodeClass {
  constructor(buffer) {
    this.position = 0
    this.buffer = buffer
  }

  changeBytes(bytes) {
    this.position += bytes
    return this.position - bytes
  }

  read(type) {
    switch (type) {
      case 'byte': {
        return this.buffer[this.changeBytes(1)]
      }
      case 'unsignedShort': {
        const result = this.buffer.readUInt16BE(this.changeBytes(2))
        return result
      }
      case 'int': {
        const result = this.buffer.readInt32BE(this.changeBytes(4))
        return result
      }
      case 'long': {
        const msb = BigInt(this.read('int'))
        const lsb = BigInt(this.read('int'))

        return msb * BigInt(2 ** 32) + lsb
      }
      case 'utf': {
        const len = this.read('unsignedShort')
        const start = this.changeBytes(len)
        const result = this.buffer.toString('utf8', start, start + len)
        return result
      }
    }
  }
}

function nodelink_decodeTrack(track) {
  const buf = new DecodeClass(Buffer.from(track, 'base64'))

  const version = ((buf.read('int') & 0xC0000000) >> 30 & 1) !== 0 ? buf.read('byte') : 1

  switch (version) {
    case 1: {
      return {
        title: buf.read('utf'),
        author: buf.read('utf'),
        length: Number(buf.read('long')),
        identifier: buf.read('utf'),
        isStream: buf.read('byte') == 1,
        uri: null,
        source: buf.read('utf'),
        position: Number(buf.read('long'))
      }
    }
    case 2: {
      return {
        title: buf.read('utf'),
        author: buf.read('utf'),
        length: Number(buf.read('long')),
        identifier: buf.read('utf'),
        isStream: buf.read('byte') == 1,
        uri: buf.read('byte') == 1 ? buf.read('utf') : null,
        source: buf.read('utf'),
        position: Number(buf.read('long'))
      }
    }
    case 3: {
      return {
        title: buf.read('utf'),
        author: buf.read('utf'),
        length: Number(buf.read('long')),
        identifier: buf.read('utf'),
        isSeekable: true,
        isStream: buf.read('byte') == 1,
        uri: buf.read('byte') == 1 ? buf.read('utf') : null,
        artworkUrl: buf.read('byte') == 1 ? buf.read('utf') : null,
        isrc: buf.read('byte') == 1 ? buf.read('utf') : null,
        sourceName: buf.read('utf'),
        position: Number(buf.read('long'))
      }
    }
  }
}

export default { nodelink_generateSessionId, nodelink_http1makeRequest, nodelink_makeRequest, nodelink_encodeTrack, nodelink_decodeTrack }