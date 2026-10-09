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
})
