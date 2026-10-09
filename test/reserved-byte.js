'use strict'

var Buffer = require('safe-buffer').Buffer
var test = require('tape').test

var reservedByteError = '0xc1 is a reserved MessagePack byte'

// lib/ and the browser bundles in dist/ built from it
var implementations = ['../', '../dist/msgpack5', '../dist/msgpack5.min']

implementations.forEach(function (impl) {
  var msgpack = require(impl)

  test(impl + ': reserved byte is invalid rather than incomplete', function (t) {
    t.plan(3)

    var pack = msgpack()
    var error

    try {
      pack.decode(Buffer.from([0xc1]))
    } catch (err) {
      error = err
    }

    t.ok(error, 'must throw an error')
    t.notOk(error instanceof pack.IncompleteBufferError, 'must not report incomplete input')
    t.equal(error && error.message, reservedByteError, 'must identify the reserved byte')
  })

  test(impl + ': stream decoder rejects reserved byte without retaining input', function (t) {
    t.plan(7)

    var decoder = msgpack().decoder()
    var decoded = 0
    var errors = []
    var closed = false
    var written = false
    var finished = false
    // the decoder settles on its own within a few ticks, this only
    // guarantees the test ends if it never does
    var timer = setTimeout(finish, 1000)

    decoder.on('data', function () {
      decoded++
    })

    decoder.on('error', function (err) {
      errors.push(err)
      maybeFinish()
    })

    // with readable-stream 2.x 'close' may be emitted before 'error'
    decoder.on('close', function () {
      closed = true
      maybeFinish()
    })

    function maybeFinish () {
      if (errors.length > 0 && closed && written) {
        finish()
      }
    }

    function finish () {
      if (finished) return
      finished = true
      clearTimeout(timer)

      t.equal(decoded, 0, 'must not emit decoded values')
      t.equal(errors.length, 1, 'must emit one error')
      t.equal(errors[0] && errors[0].message, reservedByteError, 'must emit the decoding error')
      t.equal(decoder._chunks.length, 0, 'must release buffered input')
      t.ok(written, 'must complete the write instead of stalling')
      t.ok(closed, 'must close the stream')
      t.ok(decoder.destroyed, 'must stop accepting input')
    }

    decoder.write(Buffer.concat([
      Buffer.from([0xc1]),
      Buffer.alloc(200 * 1024, 0x01)
    ]), function () {
      written = true
      maybeFinish()
    })
  })
})
