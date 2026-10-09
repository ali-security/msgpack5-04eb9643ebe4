'use strict'

var Buffer = require('safe-buffer').Buffer
var test = require('tape').test

var depthError = /Maximum decode depth exceeded/

// lib/ and the browser bundles in dist/ built from it
var implementations = ['../', '../dist/msgpack5', '../dist/msgpack5.min']

// <header> repeated depth times, followed by <tail>
function nest (header, depth, tail) {
  var buf = Buffer.alloc(header.length * depth + tail.length)
  var i
  var j

  for (i = 0; i < depth; i++) {
    for (j = 0; j < header.length; j++) {
      buf[i * header.length + j] = header[j]
    }
  }

  for (i = 0; i < tail.length; i++) {
    buf[header.length * depth + i] = tail[i]
  }

  return buf
}

// fixarray of one element: [[[...null]]]
function nestedArray (depth) {
  return nest([0x91], depth, [0xc0])
}

// fixmap of one entry: { x: { x: ... null } }
function nestedMap (depth) {
  return nest([0x81, 0xa1, 0x78], depth, [0xc0])
}

// array 16 of one element
function nestedArray16 (depth) {
  return nest([0xdc, 0x00, 0x01], depth, [0xc0])
}

// array 32 of one element
function nestedArray32 (depth) {
  return nest([0xdd, 0x00, 0x00, 0x00, 0x01], depth, [0xc0])
}

// map 16 of one entry: { x: { x: ... null } }
function nestedMap16 (depth) {
  return nest([0xde, 0x00, 0x01, 0xa1, 0x78], depth, [0xc0])
}

// maps nested through their keys: { { { null: null }: null }: null }
function nestedMapKeys (depth) {
  return nest([0x81], depth, Buffer.alloc(depth + 1, 0xc0))
}

// arrays and maps alternating: [ { x: [ { x: ... null } ] } ]
function nestedMixed (depth) {
  var buf = Buffer.alloc(Math.ceil(depth / 2) + Math.floor(depth / 2) * 3 + 1)
  var pos = 0

  for (var i = 0; i < depth; i++) {
    if (i % 2 === 0) {
      buf[pos++] = 0x91
    } else {
      buf[pos++] = 0x81
      buf[pos++] = 0xa1
      buf[pos++] = 0x78
    }
  }
  buf[pos] = 0xc0

  return buf
}

var shapes = [
  { name: 'fixarrays', build: nestedArray },
  { name: 'fixmaps', build: nestedMap },
  { name: 'array 16', build: nestedArray16 },
  { name: 'array 32', build: nestedArray32 },
  { name: 'map 16', build: nestedMap16 },
  { name: 'map keys', build: nestedMapKeys },
  { name: 'mixed arrays and maps', build: nestedMixed }
]

implementations.forEach(function (impl) {
  var msgpack = require(impl)

  test(impl + ': limits array and map nesting depth by default', function (t) {
    var pack = msgpack()
    var array = pack.decode(nestedArray(100))
    var map = pack.decode(nestedMap(100))

    for (var i = 0; i < 100; i++) {
      array = array[0]
      map = map.x
    }

    t.equal(array, null, 'decodes arrays at the limit')
    t.equal(map, null, 'decodes maps at the limit')
    t.throws(function () {
      pack.decode(nestedArray(101))
    }, depthError, 'rejects arrays over the limit')
    t.throws(function () {
      pack.decode(nestedMap(101))
    }, depthError, 'rejects maps over the limit')
    t.end()
  })

  test(impl + ': limits nesting depth for every container type', function (t) {
    var pack = msgpack()

    shapes.forEach(function (shape) {
      t.doesNotThrow(function () {
        pack.decode(shape.build(100))
      }, shape.name + ': decodes input at the limit')
      t.throws(function () {
        pack.decode(shape.build(101))
      }, depthError, shape.name + ': rejects input over the limit')
    })
    t.end()
  })

  test(impl + ': deeply nested input fails with a controlled error', function (t) {
    var pack = msgpack()

    shapes.forEach(function (shape) {
      var error

      try {
        pack.decode(shape.build(200000))
      } catch (err) {
        error = err
      }

      t.ok(error, shape.name + ': must throw an error')
      t.notOk(error instanceof RangeError, shape.name + ': does not exhaust the native stack')
      t.equal(error && error.message, 'Maximum decode depth exceeded', shape.name + ': reports the depth limit')
    })
    t.end()
  })

  test(impl + ': supports a custom maximum nesting depth', function (t) {
    var pack = msgpack({ maxDepth: 2 })

    t.doesNotThrow(function () {
      pack.decode(nestedArray(2))
    }, 'decodes input at the configured limit')
    t.throws(function () {
      pack.decode(nestedArray(3))
    }, depthError, 'rejects input over the configured limit')

    var deeper = msgpack({ maxDepth: 150 })
    t.doesNotThrow(function () {
      deeper.decode(nestedMap(150))
    }, 'allows raising the limit')
    t.throws(function () {
      deeper.decode(nestedMap(151))
    }, depthError, 'rejects input over the raised limit')
    t.end()
  })

  test(impl + ': defaults maxDepth when other options are provided', function (t) {
    var pack = msgpack({ forceFloat64: true })

    t.throws(function () {
      pack.decode(nestedArray(101))
    }, depthError)

    var undef = msgpack({ maxDepth: undefined })
    t.doesNotThrow(function () {
      undef.decode(nestedArray(100))
    }, 'undefined maxDepth decodes at the default limit')
    t.throws(function () {
      undef.decode(nestedArray(101))
    }, depthError, 'undefined maxDepth falls back to the default limit')
    t.end()
  })

  test(impl + ': allows scalars but no containers when maxDepth is zero', function (t) {
    var pack = msgpack({ maxDepth: 0 })

    t.equal(pack.decode(Buffer.from([0xc0])), null, 'decodes a scalar')
    t.throws(function () {
      pack.decode(Buffer.from([0x90]))
    }, depthError, 'rejects an empty array')
    t.throws(function () {
      pack.decode(Buffer.from([0x80]))
    }, depthError, 'rejects an empty map')
    t.end()
  })

  test(impl + ': validates maxDepth', function (t) {
    var invalid = [-1, 1.5, Infinity, NaN, '100', null]

    invalid.forEach(function (maxDepth) {
      t.throws(function () {
        msgpack({ maxDepth: maxDepth })
      }, /maxDepth must be a non-negative integer/, 'rejects ' + String(maxDepth))
    })
    t.end()
  })

  test(impl + ': reports a controlled error from the decoder stream', function (t) {
    t.plan(4)

    var decoder = msgpack().decoder()
    var decoded = 0
    var errors = []
    var finished = false
    // the decoder errors out within a few ticks, this only
    // guarantees the test ends if it never does
    var timer = setTimeout(finish, 1000)

    decoder.on('data', function () {
      decoded++
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

      t.equal(decoded, 0, 'must not emit decoded values')
      t.equal(errors.length, 1, 'must emit one error')
      t.equal(errors[0] && errors[0].message, 'Maximum decode depth exceeded', 'must emit the depth error')
      t.notOk(errors[0] instanceof RangeError, 'does not exhaust the native stack')
    }

    decoder.end(nestedArray(200000))
  })
})
