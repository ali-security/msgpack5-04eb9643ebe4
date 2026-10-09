'use strict'

var Buffer = require('safe-buffer').Buffer
var test = require('tape').test
var msgpack = require('../')
var BufferList = require('bl')

test('must send an object through', function (t) {
  t.plan(1)

  var pack = msgpack()
  var encoder = pack.encoder()
  var decoder = pack.decoder()
  var data = { hello: 'world' }

  encoder.pipe(decoder)

  decoder.on('data', function (chunk) {
    t.deepEqual(chunk, data)
  })

  encoder.end(data)
})

test('must send three objects through', function (t) {
  var pack = msgpack()
  var encoder = pack.encoder()
  var decoder = pack.decoder()
  var data = [
    { hello: 1 },
    { hello: 2 },
    { hello: 3 }
  ]

  t.plan(data.length)

  decoder.on('data', function (chunk) {
    t.deepEqual(chunk, data.shift())
  })

  data.forEach(encoder.write.bind(encoder))

  encoder.pipe(decoder)

  encoder.end()
})

test('end-to-end', function (t) {
  var pack = msgpack()
  var encoder = pack.encoder()
  var decoder = pack.decoder()
  var data = [
    { hello: 1 },
    { hello: 2 },
    { hello: 3 }
  ]

  t.plan(data.length)

  decoder.on('data', function (chunk) {
    t.deepEqual(chunk, data.shift())
  })

  data.forEach(encoder.write.bind(encoder))

  encoder.end()

  encoder.pipe(decoder)
})

test('encoding error wrapped', function (t) {
  t.plan(1)

  var pack = msgpack()
  var encoder = pack.encoder()
  var data = new MyType()

  function MyType () {
  }

  function mytypeEncode () {
    throw new Error('muahha')
  }

  function mytypeDecode () {
  }

  pack.register(0x42, MyType, mytypeEncode, mytypeDecode)

  encoder.on('error', function (err) {
    t.equal(err.message, 'muahha')
  })

  encoder.end(data)
})

test('decoding error wrapped', function (t) {
  t.plan(1)

  var pack = msgpack()
  var encoder = pack.encoder()
  var decoder = pack.decoder()
  var data = new MyType()

  function MyType () {
  }

  function mytypeEncode () {
    return Buffer.allocUnsafe(0)
  }

  function mytypeDecode () {
    throw new Error('muahha')
  }

  pack.register(0x42, MyType, mytypeEncode, mytypeDecode)

  decoder.on('error', function (err) {
    t.equal(err.message, 'muahha')
  })

  encoder.end(data)

  encoder.pipe(decoder)
})

test('decoding error wrapped', function (t) {
  t.plan(1)

  var pack = msgpack()
  var encoder = pack.encoder({ header: false })
  var decoder = pack.decoder({ header: false })
  var data = new MyType()

  function MyType () {
  }

  function mytypeEncode () {
    return Buffer.allocUnsafe(0)
  }

  function mytypeDecode () {
    throw new Error('muahha')
  }

  pack.register(0x42, MyType, mytypeEncode, mytypeDecode)

  decoder.on('error', function (err) {
    t.equal(err.message, 'muahha')
  })

  encoder.end(data)

  encoder.pipe(decoder)
})

test('concatenated buffers work', function (t) {
  var pack = msgpack()
  var encoder = pack.encoder()
  var decoder = pack.decoder()
  var data = [
    { hello: 1 },
    { hello: 2 },
    { hello: 3 }
  ]

  t.plan(data.length)

  var bl = new BufferList()
  encoder.on('data', bl.append.bind(bl))

  data.forEach(encoder.write.bind(encoder))

  decoder.on('data', function (d) {
    t.deepEqual(d, data.shift())
  })

  encoder.once('finish', function () {
    var buf = bl.slice()
    decoder.write(buf)
  })

  encoder.end()
})

// lib/ and the browser bundles in dist/ built from it
var implementations = ['../', '../dist/msgpack5', '../dist/msgpack5.min']

implementations.forEach(function (impl) {
  test(impl + ': map32 header split across chunks', function (t) {
    t.plan(2)

    var decoder = require(impl)().decoder()
    var errored = false

    decoder.on('data', function () {
      t.fail('must not decode a map32')
    })

    decoder.on('error', function (err) {
      errored = true
      t.ok(/map too big to decode in JS/.test(err.message), 'must refuse the complete map32')
    })

    var header = [0xdf, 0x00, 0x00, 0x00]
    header.forEach(function (byte) {
      decoder.write(Buffer.from([byte]))
    })

    setImmediate(function () {
      t.notOk(errored, 'must wait for the rest of the header')
      decoder.write(Buffer.from([0x00]))
    })
  })

  test(impl + ': many concatenated values do not overflow the stack', function (t) {
    t.plan(2)

    var total = 50000
    var decoder = require(impl)().decoder()
    var decoded = 0

    decoder.on('data', function () {
      decoded++
    })

    decoder.write(Buffer.alloc(total, 0x01), function (err) {
      t.error(err, 'must decode without an error')
      t.equal(decoded, total, 'must decode every value')
    })
  })

  test(impl + ': incomplete containers resume without decoding elements again', function (t) {
    t.plan(3)

    var pack = require(impl)()
    var decoder = pack.decoder()
    var values = []
    var decodeCalls = 0
    var maxBuffered = 0
    var i

    function MyType (value) {
      this.value = value
    }

    pack.register(0x42, MyType, function (obj) {
      return Buffer.from([obj.value])
    }, function (buf) {
      decodeCalls++
      return buf.readUInt8(0)
    })

    for (i = 0; i < 100; i++) {
      values.push(new MyType(i))
    }

    decoder.on('data', function (result) {
      t.deepEqual(result, { values: values.map(function (value) { return value.value }) })
      t.equal(decodeCalls, values.length, 'each completed element is decoded once')
    })

    var encoded = pack.encode({ values: values })
    for (i = 0; i < encoded.length; i++) {
      decoder.write(encoded.slice(i, i + 1))
      maxBuffered = Math.max(maxBuffered, decoder._chunks.length)
    }
    t.ok(maxBuffered <= 6, 'only the current incomplete value remains buffered')
    decoder.end()
  })

  test(impl + ': containers split at every position decode like whole input', function (t) {
    var pack = require(impl)()
    var lib = msgpack()
    var many = []
    var wide = {}
    var i

    for (i = 0; i < 20; i++) {
      many.push({ index: i, list: [i, 'item' + i, null] })
      wide['key' + i] = [i, { nested: [true, false] }]
    }

    var parts = [
      lib.encode({ hello: 'world', list: [1, 2, [3, { deep: [4, 5] }]], empty: [], none: {} }),
      // array 16 of 20 maps
      lib.encode(many),
      // map 16 of 20 entries
      lib.encode(wide),
      // array 32 of two elements
      Buffer.from([0xdd, 0x00, 0x00, 0x00, 0x02, 0x01, 0x02]),
      // array 16 with an empty array and an empty map
      Buffer.from([0xdc, 0x00, 0x02, 0x90, 0x80]),
      // map 16 with a map as key: { '[object Object]': null }
      Buffer.from([0xde, 0x00, 0x01, 0x80, 0xc0]),
      // map 16 of zero entries and empty array 32
      Buffer.from([0xde, 0x00, 0x00, 0xdd, 0x00, 0x00, 0x00, 0x00]),
      // top level scalars between containers (a top level nil ends the stream)
      Buffer.from([0x07, 0x91, 0xc3, 0xc2])
    ]

    // the values a whole-buffer decode yields
    var expected = []
    var input = Buffer.concat(parts)
    var whole = new BufferList().append(input)
    while (whole.length > 0) {
      expected.push(lib.decode(whole))
    }

    var chunkSizes = [1, 2, 3, 5, 7, 11]
    t.plan(chunkSizes.length * 2)

    chunkSizes.forEach(function (size) {
      var decoder = pack.decoder()
      var decoded = []

      decoder.on('data', function (value) {
        decoded.push(value)
      })

      decoder.on('end', function () {
        t.deepEqual(decoded, expected, size + '-byte chunks decode every value')
        t.equal(decoder._chunks.length, 0, size + '-byte chunks leave no input behind')
      })

      for (var pos = 0; pos < input.length; pos += size) {
        decoder.write(input.slice(pos, pos + size))
      }

      decoder.end()
    })
  })

  function fixstr (str) {
    var bytes = [0xa0 | str.length]
    for (var i = 0; i < str.length; i++) {
      bytes.push(str.charCodeAt(i))
    }
    return bytes
  }

  // { __proto__: { polluted: true }, hello: 'world' }
  var protoPayload = [0x82].concat(
    fixstr('__proto__'), [0x81], fixstr('polluted'), [0xc3],
    fixstr('hello'), fixstr('world'))

  // writes bytes one at a time, stopping like a producer would once
  // the decoder fails and is destroyed
  function writeBytes (decoder, bytes) {
    for (var i = 0; i < bytes.length && !decoder.destroyed; i++) {
      decoder.write(Buffer.from([bytes[i]]))
    }
  }

  // runs the decoder over bytes, written one at a time, and calls back
  // with every decoded value and error once it settles
  function decodeSplit (decoder, bytes, cb) {
    var decoded = []
    var errors = []
    var finished = false
    // the decoder settles within a few ticks, this only
    // guarantees the test ends if it never does
    var timer = setTimeout(finish, 1000)

    decoder.on('data', function (value) {
      decoded.push(value)
    })

    decoder.on('error', function (err) {
      errors.push(err)
      // with readable-stream 2.x 'close' may be emitted before 'error'
      setTimeout(finish, 10)
    })

    function finish () {
      if (finished) return
      finished = true
      clearTimeout(timer)
      cb(decoded, errors)
    }

    writeBytes(decoder, bytes)
    if (!decoder.destroyed) {
      decoder.end(function () {
        setTimeout(finish, 10)
      })
    }
  }

  test(impl + ': rejects a forbidden __proto__ key split across chunks', function (t) {
    t.plan(4)

    var decoder = require(impl)().decoder()

    decodeSplit(decoder, protoPayload, function (decoded, errors) {
      t.equal(decoded.length, 0, 'must not emit decoded values')
      t.equal(errors.length, 1, 'must emit one error')
      t.ok(errors[0] instanceof SyntaxError, 'must emit a SyntaxError')
      t.equal(errors[0] && errors[0].message, 'Object contains forbidden prototype property')
    })
  })

  test(impl + ': removes a forbidden __proto__ key split across chunks', function (t) {
    t.plan(5)

    var decoder = require(impl)({ protoAction: 'remove' }).decoder()

    decodeSplit(decoder, protoPayload, function (decoded, errors) {
      t.equal(errors.length, 0, 'must not emit an error')
      t.equal(decoded.length, 1, 'must emit the map')
      t.deepEqual(decoded[0], { hello: 'world' })
      t.equal(Object.getPrototypeOf(decoded[0]), Object.prototype, 'must keep the prototype')
      t.equal({}.polluted, undefined, 'does not affect Object.prototype')
    })
  })

  test(impl + ': limits nesting depth of containers split across chunks', function (t) {
    t.plan(6)

    var pack = require(impl)({ maxDepth: 2 })

    decodeSplit(pack.decoder(), [0x91, 0x81, 0xa1, 0x78, 0xc0], function (decoded, errors) {
      t.equal(errors.length, 0, 'must not emit an error at the limit')
      t.deepEqual(decoded, [[{ x: null }]], 'must decode input at the limit')

      var decoder = pack.decoder()
      decodeSplit(decoder, [0x91, 0x91, 0x91, 0xc0], function (decoded, errors) {
        t.equal(decoded.length, 0, 'must not emit decoded values')
        t.equal(errors.length, 1, 'must emit one error')
        t.equal(errors[0] && errors[0].message, 'Maximum decode depth exceeded')
        t.equal(decoder._decodeState.stack.length, 0, 'must drop the partially decoded containers')
      })
    })
  })

  test(impl + ': decode ignores a second argument that is not a decode state', function (t) {
    var pack = require(impl)()
    var bufs = [
      pack.encode({ a: [1, 2] }),
      pack.encode([{ b: 3 }]),
      pack.encode('c')
    ]

    t.deepEqual(bufs.map(pack.decode), [{ a: [1, 2] }, [{ b: 3 }], 'c'], 'decodes as an Array#map callback')
    t.deepEqual(pack.decode(bufs[0], {}), { a: [1, 2] }, 'decodes with an unrelated second argument')
    t.end()
  })
})
