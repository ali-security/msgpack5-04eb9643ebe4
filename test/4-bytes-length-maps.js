'use strict'

var Buffer = require('safe-buffer').Buffer
var test = require('tape').test
var msgpack = require('../')
var bl = require('bl')

test('decoding incomplete map32 headers', function (t) {
  var pack = msgpack()

  function check (length) {
    var buf = Buffer.alloc(length)
    buf[0] = 0xdf
    var input = bl().append(buf)

    t.throws(function () {
      pack.decode(input)
    }, pack.IncompleteBufferError, 'must reject a ' + length + '-byte header as incomplete')
    t.equal(input.length, length, 'must not consume an incomplete header')
  }

  for (var length = 1; length < 5; length++) {
    check(length)
  }

  t.end()
})

test('decoding a complete map32 header', function (t) {
  var pack = msgpack()
  var buf = Buffer.from([0xdf, 0x00, 0x00, 0x00, 0x00])

  t.throws(function () {
    pack.decode(buf)
  }, /map too big to decode in JS/, 'must still refuse to decode a map32')
  t.end()
})

// the browser bundles in dist/ are built from lib/ and must behave the same
var bundles = ['../dist/msgpack5', '../dist/msgpack5.min']

bundles.forEach(function (bundle) {
  test(bundle + ': decoding incomplete map32 headers', function (t) {
    var pack = require(bundle)()

    function check (length) {
      var buf = Buffer.alloc(length)
      buf[0] = 0xdf

      t.throws(function () {
        pack.decode(buf)
      }, pack.IncompleteBufferError, 'must reject a ' + length + '-byte header as incomplete')
    }

    for (var length = 1; length < 5; length++) {
      check(length)
    }

    t.end()
  })

  test(bundle + ': decoding a complete map32 header', function (t) {
    var pack = require(bundle)()
    var buf = Buffer.from([0xdf, 0x00, 0x00, 0x00, 0x00])

    t.throws(function () {
      pack.decode(buf)
    }, /map too big to decode in JS/, 'must still refuse to decode a map32')
    t.end()
  })
})
