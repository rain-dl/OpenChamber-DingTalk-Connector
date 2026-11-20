import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// node_modules/ws/lib/stream.js
var require_stream = __commonJS(function(exports, module) {
  var { Duplex } = __require("stream");
  function emitClose(stream) {
    stream.emit("close");
  }
  function duplexOnEnd() {
    if (!this.destroyed && this._writableState.finished) {
      this.destroy();
    }
  }
  function duplexOnError(err) {
    this.removeListener("error", duplexOnError);
    this.destroy();
    if (this.listenerCount("error") === 0) {
      this.emit("error", err);
    }
  }
  function createWebSocketStream(ws, options) {
    let terminateOnDestroy = true;
    const duplex = new Duplex({
      ...options,
      autoDestroy: false,
      emitClose: false,
      objectMode: false,
      writableObjectMode: false
    });
    ws.on("message", function message(msg, isBinary) {
      const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
      if (!duplex.push(data))
        ws.pause();
    });
    ws.once("error", function error(err) {
      if (duplex.destroyed)
        return;
      terminateOnDestroy = false;
      duplex.destroy(err);
    });
    ws.once("close", function close() {
      if (duplex.destroyed)
        return;
      duplex.push(null);
    });
    duplex._destroy = function(err, callback) {
      if (ws.readyState === ws.CLOSED) {
        callback(err);
        process.nextTick(emitClose, duplex);
        return;
      }
      let called = false;
      ws.once("error", function error(err) {
        called = true;
        callback(err);
      });
      ws.once("close", function close() {
        if (!called)
          callback(err);
        process.nextTick(emitClose, duplex);
      });
      if (terminateOnDestroy)
        ws.terminate();
    };
    duplex._final = function(callback) {
      if (ws.readyState === ws.CONNECTING) {
        ws.once("open", function open() {
          duplex._final(callback);
        });
        return;
      }
      if (ws._socket === null)
        return;
      if (ws._socket._writableState.finished) {
        callback();
        if (duplex._readableState.endEmitted)
          duplex.destroy();
      } else {
        ws._socket.once("finish", function finish() {
          callback();
        });
        ws.close();
      }
    };
    duplex._read = function() {
      if (ws.isPaused)
        ws.resume();
    };
    duplex._write = function(chunk, encoding, callback) {
      if (ws.readyState === ws.CONNECTING) {
        ws.once("open", function open() {
          duplex._write(chunk, encoding, callback);
        });
        return;
      }
      ws.send(chunk, callback);
    };
    duplex.on("end", duplexOnEnd);
    duplex.on("error", duplexOnError);
    return duplex;
  }
  module.exports = createWebSocketStream;
});

// node_modules/ws/lib/constants.js
var require_constants = __commonJS(function(exports, module) {
  var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
  var hasBlob = typeof Blob !== "undefined";
  if (hasBlob)
    BINARY_TYPES.push("blob");
  module.exports = {
    BINARY_TYPES,
    EMPTY_BUFFER: Buffer.alloc(0),
    GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
    hasBlob,
    kForOnEventAttribute: Symbol("kIsForOnEventAttribute"),
    kListener: Symbol("kListener"),
    kStatusCode: Symbol("status-code"),
    kWebSocket: Symbol("websocket"),
    NOOP: () => {}
  };
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS(function(exports, module) {
  var { EMPTY_BUFFER } = require_constants();
  var FastBuffer = Buffer[Symbol.species];
  function concat(list, totalLength) {
    if (list.length === 0)
      return EMPTY_BUFFER;
    if (list.length === 1)
      return list[0];
    const target = Buffer.allocUnsafe(totalLength);
    let offset = 0;
    for (let i = 0;i < list.length; i++) {
      const buf = list[i];
      target.set(buf, offset);
      offset += buf.length;
    }
    if (offset < totalLength) {
      return new FastBuffer(target.buffer, target.byteOffset, offset);
    }
    return target;
  }
  function _mask(source, mask, output, offset, length) {
    for (let i = 0;i < length; i++) {
      output[offset + i] = source[i] ^ mask[i & 3];
    }
  }
  function _unmask(buffer, mask) {
    for (let i = 0;i < buffer.length; i++) {
      buffer[i] ^= mask[i & 3];
    }
  }
  function toArrayBuffer(buf) {
    if (buf.length === buf.buffer.byteLength) {
      return buf.buffer;
    }
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  }
  function toBuffer(data) {
    toBuffer.readOnly = true;
    if (Buffer.isBuffer(data))
      return data;
    let buf;
    if (data instanceof ArrayBuffer) {
      buf = new FastBuffer(data);
    } else if (ArrayBuffer.isView(data)) {
      buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
    } else {
      buf = Buffer.from(data);
      toBuffer.readOnly = false;
    }
    return buf;
  }
  module.exports = {
    concat,
    mask: _mask,
    toArrayBuffer,
    toBuffer,
    unmask: _unmask
  };
  if (!process.env.WS_NO_BUFFER_UTIL) {
    try {
      const bufferUtil = (()=>{throw new Error("Cannot require module "+"bufferutil");})();
      module.exports.mask = function(source, mask2, output, offset, length) {
        if (length < 48)
          _mask(source, mask2, output, offset, length);
        else
          bufferUtil.mask(source, mask2, output, offset, length);
      };
      module.exports.unmask = function(buffer, mask) {
        if (buffer.length < 32)
          _unmask(buffer, mask);
        else
          bufferUtil.unmask(buffer, mask);
      };
    } catch (e) {}
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS(function(exports, module) {
  var kDone = Symbol("kDone");
  var kRun = Symbol("kRun");

  class Limiter {
    constructor(concurrency) {
      this[kDone] = () => {
        this.pending--;
        this[kRun]();
      };
      this.concurrency = concurrency || Infinity;
      this.jobs = [];
      this.pending = 0;
    }
    add(job) {
      this.jobs.push(job);
      this[kRun]();
    }
    [kRun]() {
      if (this.pending === this.concurrency)
        return;
      if (this.jobs.length) {
        const job = this.jobs.shift();
        this.pending++;
        job(this[kDone]);
      }
    }
  }
  module.exports = Limiter;
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS(function(exports, module) {
  var zlib = __require("zlib");
  var bufferUtil = require_buffer_util();
  var Limiter = require_limiter();
  var { kStatusCode } = require_constants();
  var FastBuffer = Buffer[Symbol.species];
  var TRAILER = Buffer.from([0, 0, 255, 255]);
  var kPerMessageDeflate = Symbol("permessage-deflate");
  var kTotalLength = Symbol("total-length");
  var kCallback = Symbol("callback");
  var kBuffers = Symbol("buffers");
  var kError = Symbol("error");
  var zlibLimiter;

  class PerMessageDeflate {
    constructor(options, isServer, maxPayload) {
      this._maxPayload = maxPayload | 0;
      this._options = options || {};
      this._threshold = this._options.threshold !== undefined ? this._options.threshold : 1024;
      this._isServer = !!isServer;
      this._deflate = null;
      this._inflate = null;
      this.params = null;
      if (!zlibLimiter) {
        const concurrency = this._options.concurrencyLimit !== undefined ? this._options.concurrencyLimit : 10;
        zlibLimiter = new Limiter(concurrency);
      }
    }
    static get extensionName() {
      return "permessage-deflate";
    }
    offer() {
      const params = {};
      if (this._options.serverNoContextTakeover) {
        params.server_no_context_takeover = true;
      }
      if (this._options.clientNoContextTakeover) {
        params.client_no_context_takeover = true;
      }
      if (this._options.serverMaxWindowBits) {
        params.server_max_window_bits = this._options.serverMaxWindowBits;
      }
      if (this._options.clientMaxWindowBits) {
        params.client_max_window_bits = this._options.clientMaxWindowBits;
      } else if (this._options.clientMaxWindowBits == null) {
        params.client_max_window_bits = true;
      }
      return params;
    }
    accept(configurations) {
      configurations = this.normalizeParams(configurations);
      this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
      return this.params;
    }
    cleanup() {
      if (this._inflate) {
        this._inflate.close();
        this._inflate = null;
      }
      if (this._deflate) {
        const callback = this._deflate[kCallback];
        this._deflate.close();
        this._deflate = null;
        if (callback) {
          callback(new Error("The deflate stream was closed while data was being processed"));
        }
      }
    }
    acceptAsServer(offers) {
      const opts = this._options;
      const accepted = offers.find((params) => {
        if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
          return false;
        }
        return true;
      });
      if (!accepted) {
        throw new Error("None of the extension offers can be accepted");
      }
      if (opts.serverNoContextTakeover) {
        accepted.server_no_context_takeover = true;
      }
      if (opts.clientNoContextTakeover) {
        accepted.client_no_context_takeover = true;
      }
      if (typeof opts.serverMaxWindowBits === "number") {
        accepted.server_max_window_bits = opts.serverMaxWindowBits;
      }
      if (typeof opts.clientMaxWindowBits === "number") {
        accepted.client_max_window_bits = opts.clientMaxWindowBits;
      } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
        delete accepted.client_max_window_bits;
      }
      return accepted;
    }
    acceptAsClient(response) {
      const params = response[0];
      if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
        throw new Error('Unexpected parameter "client_no_context_takeover"');
      }
      if (!params.client_max_window_bits) {
        if (typeof this._options.clientMaxWindowBits === "number") {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        }
      } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
        throw new Error('Unexpected or invalid parameter "client_max_window_bits"');
      }
      return params;
    }
    normalizeParams(configurations) {
      configurations.forEach((params) => {
        Object.keys(params).forEach((key) => {
          let value = params[key];
          if (value.length > 1) {
            throw new Error(`Parameter "${key}" must have only a single value`);
          }
          value = value[0];
          if (key === "client_max_window_bits") {
            if (value !== true) {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
              }
              value = num;
            } else if (!this._isServer) {
              throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
            }
          } else if (key === "server_max_window_bits") {
            const num = +value;
            if (!Number.isInteger(num) || num < 8 || num > 15) {
              throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
            }
            value = num;
          } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
            if (value !== true) {
              throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
            }
          } else {
            throw new Error(`Unknown parameter "${key}"`);
          }
          params[key] = value;
        });
      });
      return configurations;
    }
    decompress(data, fin, callback) {
      zlibLimiter.add((done) => {
        this._decompress(data, fin, (err, result) => {
          done();
          callback(err, result);
        });
      });
    }
    compress(data, fin, callback) {
      zlibLimiter.add((done) => {
        this._compress(data, fin, (err, result) => {
          done();
          callback(err, result);
        });
      });
    }
    _decompress(data, fin, callback) {
      const endpoint = this._isServer ? "client" : "server";
      if (!this._inflate) {
        const key = `${endpoint}_max_window_bits`;
        const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
        this._inflate = zlib.createInflateRaw({
          ...this._options.zlibInflateOptions,
          windowBits
        });
        this._inflate[kPerMessageDeflate] = this;
        this._inflate[kTotalLength] = 0;
        this._inflate[kBuffers] = [];
        this._inflate.on("error", inflateOnError);
        this._inflate.on("data", inflateOnData);
      }
      this._inflate[kCallback] = callback;
      this._inflate.write(data);
      if (fin)
        this._inflate.write(TRAILER);
      this._inflate.flush(() => {
        const err = this._inflate[kError];
        if (err) {
          this._inflate.close();
          this._inflate = null;
          callback(err);
          return;
        }
        const data = bufferUtil.concat(this._inflate[kBuffers], this._inflate[kTotalLength]);
        if (this._inflate._readableState.endEmitted) {
          this._inflate.close();
          this._inflate = null;
        } else {
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._inflate.reset();
          }
        }
        callback(null, data);
      });
    }
    _compress(data, fin, callback) {
      const endpoint = this._isServer ? "server" : "client";
      if (!this._deflate) {
        const key = `${endpoint}_max_window_bits`;
        const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
        this._deflate = zlib.createDeflateRaw({
          ...this._options.zlibDeflateOptions,
          windowBits
        });
        this._deflate[kTotalLength] = 0;
        this._deflate[kBuffers] = [];
        this._deflate.on("data", deflateOnData);
      }
      this._deflate[kCallback] = callback;
      this._deflate.write(data);
      this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
        if (!this._deflate) {
          return;
        }
        let data = bufferUtil.concat(this._deflate[kBuffers], this._deflate[kTotalLength]);
        if (fin) {
          data = new FastBuffer(data.buffer, data.byteOffset, data.length - 4);
        }
        this._deflate[kCallback] = null;
        this._deflate[kTotalLength] = 0;
        this._deflate[kBuffers] = [];
        if (fin && this.params[`${endpoint}_no_context_takeover`]) {
          this._deflate.reset();
        }
        callback(null, data);
      });
    }
  }
  module.exports = PerMessageDeflate;
  function deflateOnData(chunk) {
    this[kBuffers].push(chunk);
    this[kTotalLength] += chunk.length;
  }
  function inflateOnData(chunk) {
    this[kTotalLength] += chunk.length;
    if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
      this[kBuffers].push(chunk);
      return;
    }
    this[kError] = new RangeError("Max payload size exceeded");
    this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
    this[kError][kStatusCode] = 1009;
    this.removeListener("data", inflateOnData);
    this.reset();
  }
  function inflateOnError(err) {
    this[kPerMessageDeflate]._inflate = null;
    err[kStatusCode] = 1007;
    this[kCallback](err);
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS(function(exports, module) {
  var { isUtf8 } = __require("buffer");
  var { hasBlob } = require_constants();
  var tokenChars = [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    1,
    1,
    1,
    1,
    1,
    0,
    0,
    1,
    1,
    0,
    1,
    1,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    1,
    0,
    1,
    0
  ];
  function isValidStatusCode(code) {
    return code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3000 && code <= 4999;
  }
  function _isValidUTF8(buf) {
    const len = buf.length;
    let i = 0;
    while (i < len) {
      if ((buf[i] & 128) === 0) {
        i++;
      } else if ((buf[i] & 224) === 192) {
        if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
          return false;
        }
        i += 2;
      } else if ((buf[i] & 240) === 224) {
        if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || buf[i] === 237 && (buf[i + 1] & 224) === 160) {
          return false;
        }
        i += 3;
      } else if ((buf[i] & 248) === 240) {
        if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
          return false;
        }
        i += 4;
      } else {
        return false;
      }
    }
    return true;
  }
  function isBlob(value) {
    return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
  }
  module.exports = {
    isBlob,
    isValidStatusCode,
    isValidUTF8: _isValidUTF8,
    tokenChars
  };
  if (isUtf8) {
    module.exports.isValidUTF8 = function(buf) {
      return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
    };
  } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
    try {
      const isValidUTF8 = (()=>{throw new Error("Cannot require module "+"utf-8-validate");})();
      module.exports.isValidUTF8 = function(buf) {
        return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
      };
    } catch (e) {}
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS(function(exports, module) {
  var { Writable } = __require("stream");
  var PerMessageDeflate = require_permessage_deflate();
  var {
    BINARY_TYPES,
    EMPTY_BUFFER,
    kStatusCode,
    kWebSocket
  } = require_constants();
  var { concat, toArrayBuffer, unmask } = require_buffer_util();
  var { isValidStatusCode, isValidUTF8 } = require_validation();
  var FastBuffer = Buffer[Symbol.species];
  var GET_INFO = 0;
  var GET_PAYLOAD_LENGTH_16 = 1;
  var GET_PAYLOAD_LENGTH_64 = 2;
  var GET_MASK = 3;
  var GET_DATA = 4;
  var INFLATING = 5;
  var DEFER_EVENT = 6;

  class Receiver extends Writable {
    constructor(options = {}) {
      super();
      this._allowSynchronousEvents = options.allowSynchronousEvents !== undefined ? options.allowSynchronousEvents : true;
      this._binaryType = options.binaryType || BINARY_TYPES[0];
      this._extensions = options.extensions || {};
      this._isServer = !!options.isServer;
      this._maxPayload = options.maxPayload | 0;
      this._skipUTF8Validation = !!options.skipUTF8Validation;
      this[kWebSocket] = undefined;
      this._bufferedBytes = 0;
      this._buffers = [];
      this._compressed = false;
      this._payloadLength = 0;
      this._mask = undefined;
      this._fragmented = 0;
      this._masked = false;
      this._fin = false;
      this._opcode = 0;
      this._totalPayloadLength = 0;
      this._messageLength = 0;
      this._fragments = [];
      this._errored = false;
      this._loop = false;
      this._state = GET_INFO;
    }
    _write(chunk, encoding, cb) {
      if (this._opcode === 8 && this._state == GET_INFO)
        return cb();
      this._bufferedBytes += chunk.length;
      this._buffers.push(chunk);
      this.startLoop(cb);
    }
    consume(n) {
      this._bufferedBytes -= n;
      if (n === this._buffers[0].length)
        return this._buffers.shift();
      if (n < this._buffers[0].length) {
        const buf = this._buffers[0];
        this._buffers[0] = new FastBuffer(buf.buffer, buf.byteOffset + n, buf.length - n);
        return new FastBuffer(buf.buffer, buf.byteOffset, n);
      }
      const dst = Buffer.allocUnsafe(n);
      do {
        const buf = this._buffers[0];
        const offset = dst.length - n;
        if (n >= buf.length) {
          dst.set(this._buffers.shift(), offset);
        } else {
          dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
          this._buffers[0] = new FastBuffer(buf.buffer, buf.byteOffset + n, buf.length - n);
        }
        n -= buf.length;
      } while (n > 0);
      return dst;
    }
    startLoop(cb) {
      this._loop = true;
      do {
        switch (this._state) {
          case GET_INFO:
            this.getInfo(cb);
            break;
          case GET_PAYLOAD_LENGTH_16:
            this.getPayloadLength16(cb);
            break;
          case GET_PAYLOAD_LENGTH_64:
            this.getPayloadLength64(cb);
            break;
          case GET_MASK:
            this.getMask();
            break;
          case GET_DATA:
            this.getData(cb);
            break;
          case INFLATING:
          case DEFER_EVENT:
            this._loop = false;
            return;
        }
      } while (this._loop);
      if (!this._errored)
        cb();
    }
    getInfo(cb) {
      if (this._bufferedBytes < 2) {
        this._loop = false;
        return;
      }
      const buf = this.consume(2);
      if ((buf[0] & 48) !== 0) {
        const error = this.createError(RangeError, "RSV2 and RSV3 must be clear", true, 1002, "WS_ERR_UNEXPECTED_RSV_2_3");
        cb(error);
        return;
      }
      const compressed = (buf[0] & 64) === 64;
      if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
        const error = this.createError(RangeError, "RSV1 must be clear", true, 1002, "WS_ERR_UNEXPECTED_RSV_1");
        cb(error);
        return;
      }
      this._fin = (buf[0] & 128) === 128;
      this._opcode = buf[0] & 15;
      this._payloadLength = buf[1] & 127;
      if (this._opcode === 0) {
        if (compressed) {
          const error = this.createError(RangeError, "RSV1 must be clear", true, 1002, "WS_ERR_UNEXPECTED_RSV_1");
          cb(error);
          return;
        }
        if (!this._fragmented) {
          const error = this.createError(RangeError, "invalid opcode 0", true, 1002, "WS_ERR_INVALID_OPCODE");
          cb(error);
          return;
        }
        this._opcode = this._fragmented;
      } else if (this._opcode === 1 || this._opcode === 2) {
        if (this._fragmented) {
          const error = this.createError(RangeError, `invalid opcode ${this._opcode}`, true, 1002, "WS_ERR_INVALID_OPCODE");
          cb(error);
          return;
        }
        this._compressed = compressed;
      } else if (this._opcode > 7 && this._opcode < 11) {
        if (!this._fin) {
          const error = this.createError(RangeError, "FIN must be set", true, 1002, "WS_ERR_EXPECTED_FIN");
          cb(error);
          return;
        }
        if (compressed) {
          const error = this.createError(RangeError, "RSV1 must be clear", true, 1002, "WS_ERR_UNEXPECTED_RSV_1");
          cb(error);
          return;
        }
        if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
          const error = this.createError(RangeError, `invalid payload length ${this._payloadLength}`, true, 1002, "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH");
          cb(error);
          return;
        }
      } else {
        const error = this.createError(RangeError, `invalid opcode ${this._opcode}`, true, 1002, "WS_ERR_INVALID_OPCODE");
        cb(error);
        return;
      }
      if (!this._fin && !this._fragmented)
        this._fragmented = this._opcode;
      this._masked = (buf[1] & 128) === 128;
      if (this._isServer) {
        if (!this._masked) {
          const error = this.createError(RangeError, "MASK must be set", true, 1002, "WS_ERR_EXPECTED_MASK");
          cb(error);
          return;
        }
      } else if (this._masked) {
        const error = this.createError(RangeError, "MASK must be clear", true, 1002, "WS_ERR_UNEXPECTED_MASK");
        cb(error);
        return;
      }
      if (this._payloadLength === 126)
        this._state = GET_PAYLOAD_LENGTH_16;
      else if (this._payloadLength === 127)
        this._state = GET_PAYLOAD_LENGTH_64;
      else
        this.haveLength(cb);
    }
    getPayloadLength16(cb) {
      if (this._bufferedBytes < 2) {
        this._loop = false;
        return;
      }
      this._payloadLength = this.consume(2).readUInt16BE(0);
      this.haveLength(cb);
    }
    getPayloadLength64(cb) {
      if (this._bufferedBytes < 8) {
        this._loop = false;
        return;
      }
      const buf = this.consume(8);
      const num = buf.readUInt32BE(0);
      if (num > Math.pow(2, 53 - 32) - 1) {
        const error = this.createError(RangeError, "Unsupported WebSocket frame: payload length > 2^53 - 1", false, 1009, "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH");
        cb(error);
        return;
      }
      this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
      this.haveLength(cb);
    }
    haveLength(cb) {
      if (this._payloadLength && this._opcode < 8) {
        this._totalPayloadLength += this._payloadLength;
        if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
          const error = this.createError(RangeError, "Max payload size exceeded", false, 1009, "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH");
          cb(error);
          return;
        }
      }
      if (this._masked)
        this._state = GET_MASK;
      else
        this._state = GET_DATA;
    }
    getMask() {
      if (this._bufferedBytes < 4) {
        this._loop = false;
        return;
      }
      this._mask = this.consume(4);
      this._state = GET_DATA;
    }
    getData(cb) {
      let data = EMPTY_BUFFER;
      if (this._payloadLength) {
        if (this._bufferedBytes < this._payloadLength) {
          this._loop = false;
          return;
        }
        data = this.consume(this._payloadLength);
        if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
          unmask(data, this._mask);
        }
      }
      if (this._opcode > 7) {
        this.controlMessage(data, cb);
        return;
      }
      if (this._compressed) {
        this._state = INFLATING;
        this.decompress(data, cb);
        return;
      }
      if (data.length) {
        this._messageLength = this._totalPayloadLength;
        this._fragments.push(data);
      }
      this.dataMessage(cb);
    }
    decompress(data, cb) {
      const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
      perMessageDeflate.decompress(data, this._fin, (err, buf) => {
        if (err)
          return cb(err);
        if (buf.length) {
          this._messageLength += buf.length;
          if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(RangeError, "Max payload size exceeded", false, 1009, "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH");
            cb(error);
            return;
          }
          this._fragments.push(buf);
        }
        this.dataMessage(cb);
        if (this._state === GET_INFO)
          this.startLoop(cb);
      });
    }
    dataMessage(cb) {
      if (!this._fin) {
        this._state = GET_INFO;
        return;
      }
      const messageLength = this._messageLength;
      const fragments = this._fragments;
      this._totalPayloadLength = 0;
      this._messageLength = 0;
      this._fragmented = 0;
      this._fragments = [];
      if (this._opcode === 2) {
        let data;
        if (this._binaryType === "nodebuffer") {
          data = concat(fragments, messageLength);
        } else if (this._binaryType === "arraybuffer") {
          data = toArrayBuffer(concat(fragments, messageLength));
        } else if (this._binaryType === "blob") {
          data = new Blob(fragments);
        } else {
          data = fragments;
        }
        if (this._allowSynchronousEvents) {
          this.emit("message", data, true);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit("message", data, true);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      } else {
        const buf = concat(fragments, messageLength);
        if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
          const error = this.createError(Error, "invalid UTF-8 sequence", true, 1007, "WS_ERR_INVALID_UTF8");
          cb(error);
          return;
        }
        if (this._state === INFLATING || this._allowSynchronousEvents) {
          this.emit("message", buf, false);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit("message", buf, false);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
    }
    controlMessage(data, cb) {
      if (this._opcode === 8) {
        if (data.length === 0) {
          this._loop = false;
          this.emit("conclude", 1005, EMPTY_BUFFER);
          this.end();
        } else {
          const code = data.readUInt16BE(0);
          if (!isValidStatusCode(code)) {
            const error = this.createError(RangeError, `invalid status code ${code}`, true, 1002, "WS_ERR_INVALID_CLOSE_CODE");
            cb(error);
            return;
          }
          const buf = new FastBuffer(data.buffer, data.byteOffset + 2, data.length - 2);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(Error, "invalid UTF-8 sequence", true, 1007, "WS_ERR_INVALID_UTF8");
            cb(error);
            return;
          }
          this._loop = false;
          this.emit("conclude", code, buf);
          this.end();
        }
        this._state = GET_INFO;
        return;
      }
      if (this._allowSynchronousEvents) {
        this.emit(this._opcode === 9 ? "ping" : "pong", data);
        this._state = GET_INFO;
      } else {
        this._state = DEFER_EVENT;
        setImmediate(() => {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
          this.startLoop(cb);
        });
      }
    }
    createError(ErrorCtor, message, prefix, statusCode, errorCode) {
      this._loop = false;
      this._errored = true;
      const err = new ErrorCtor(prefix ? `Invalid WebSocket frame: ${message}` : message);
      Error.captureStackTrace(err, this.createError);
      err.code = errorCode;
      err[kStatusCode] = statusCode;
      return err;
    }
  }
  module.exports = Receiver;
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS(function(exports, module) {
  var { Duplex } = __require("stream");
  var { randomFillSync } = __require("crypto");
  var PerMessageDeflate = require_permessage_deflate();
  var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
  var { isBlob, isValidStatusCode } = require_validation();
  var { mask: applyMask, toBuffer } = require_buffer_util();
  var kByteLength = Symbol("kByteLength");
  var maskBuffer = Buffer.alloc(4);
  var RANDOM_POOL_SIZE = 8 * 1024;
  var randomPool;
  var randomPoolPointer = RANDOM_POOL_SIZE;
  var DEFAULT = 0;
  var DEFLATING = 1;
  var GET_BLOB_DATA = 2;

  class Sender {
    constructor(socket, extensions, generateMask) {
      this._extensions = extensions || {};
      if (generateMask) {
        this._generateMask = generateMask;
        this._maskBuffer = Buffer.alloc(4);
      }
      this._socket = socket;
      this._firstFragment = true;
      this._compress = false;
      this._bufferedBytes = 0;
      this._queue = [];
      this._state = DEFAULT;
      this.onerror = NOOP;
      this[kWebSocket] = undefined;
    }
    static frame(data, options) {
      let mask;
      let merge = false;
      let offset = 2;
      let skipMasking = false;
      if (options.mask) {
        mask = options.maskBuffer || maskBuffer;
        if (options.generateMask) {
          options.generateMask(mask);
        } else {
          if (randomPoolPointer === RANDOM_POOL_SIZE) {
            if (randomPool === undefined) {
              randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
            }
            randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
            randomPoolPointer = 0;
          }
          mask[0] = randomPool[randomPoolPointer++];
          mask[1] = randomPool[randomPoolPointer++];
          mask[2] = randomPool[randomPoolPointer++];
          mask[3] = randomPool[randomPoolPointer++];
        }
        skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
        offset = 6;
      }
      let dataLength;
      if (typeof data === "string") {
        if ((!options.mask || skipMasking) && options[kByteLength] !== undefined) {
          dataLength = options[kByteLength];
        } else {
          data = Buffer.from(data);
          dataLength = data.length;
        }
      } else {
        dataLength = data.length;
        merge = options.mask && options.readOnly && !skipMasking;
      }
      let payloadLength = dataLength;
      if (dataLength >= 65536) {
        offset += 8;
        payloadLength = 127;
      } else if (dataLength > 125) {
        offset += 2;
        payloadLength = 126;
      }
      const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
      target[0] = options.fin ? options.opcode | 128 : options.opcode;
      if (options.rsv1)
        target[0] |= 64;
      target[1] = payloadLength;
      if (payloadLength === 126) {
        target.writeUInt16BE(dataLength, 2);
      } else if (payloadLength === 127) {
        target[2] = target[3] = 0;
        target.writeUIntBE(dataLength, 4, 6);
      }
      if (!options.mask)
        return [target, data];
      target[1] |= 128;
      target[offset - 4] = mask[0];
      target[offset - 3] = mask[1];
      target[offset - 2] = mask[2];
      target[offset - 1] = mask[3];
      if (skipMasking)
        return [target, data];
      if (merge) {
        applyMask(data, mask, target, offset, dataLength);
        return [target];
      }
      applyMask(data, mask, data, 0, dataLength);
      return [target, data];
    }
    close(code, data, mask, cb) {
      let buf;
      if (code === undefined) {
        buf = EMPTY_BUFFER;
      } else if (typeof code !== "number" || !isValidStatusCode(code)) {
        throw new TypeError("First argument must be a valid error code number");
      } else if (data === undefined || !data.length) {
        buf = Buffer.allocUnsafe(2);
        buf.writeUInt16BE(code, 0);
      } else {
        const length = Buffer.byteLength(data);
        if (length > 123) {
          throw new RangeError("The message must not be greater than 123 bytes");
        }
        buf = Buffer.allocUnsafe(2 + length);
        buf.writeUInt16BE(code, 0);
        if (typeof data === "string") {
          buf.write(data, 2);
        } else {
          buf.set(data, 2);
        }
      }
      const options = {
        [kByteLength]: buf.length,
        fin: true,
        generateMask: this._generateMask,
        mask,
        maskBuffer: this._maskBuffer,
        opcode: 8,
        readOnly: false,
        rsv1: false
      };
      if (this._state !== DEFAULT) {
        this.enqueue([this.dispatch, buf, false, options, cb]);
      } else {
        this.sendFrame(Sender.frame(buf, options), cb);
      }
    }
    ping(data, mask, cb) {
      let byteLength;
      let readOnly;
      if (typeof data === "string") {
        byteLength = Buffer.byteLength(data);
        readOnly = false;
      } else if (isBlob(data)) {
        byteLength = data.size;
        readOnly = false;
      } else {
        data = toBuffer(data);
        byteLength = data.length;
        readOnly = toBuffer.readOnly;
      }
      if (byteLength > 125) {
        throw new RangeError("The data size must not be greater than 125 bytes");
      }
      const options = {
        [kByteLength]: byteLength,
        fin: true,
        generateMask: this._generateMask,
        mask,
        maskBuffer: this._maskBuffer,
        opcode: 9,
        readOnly,
        rsv1: false
      };
      if (isBlob(data)) {
        if (this._state !== DEFAULT) {
          this.enqueue([this.getBlobData, data, false, options, cb]);
        } else {
          this.getBlobData(data, false, options, cb);
        }
      } else if (this._state !== DEFAULT) {
        this.enqueue([this.dispatch, data, false, options, cb]);
      } else {
        this.sendFrame(Sender.frame(data, options), cb);
      }
    }
    pong(data, mask, cb) {
      let byteLength;
      let readOnly;
      if (typeof data === "string") {
        byteLength = Buffer.byteLength(data);
        readOnly = false;
      } else if (isBlob(data)) {
        byteLength = data.size;
        readOnly = false;
      } else {
        data = toBuffer(data);
        byteLength = data.length;
        readOnly = toBuffer.readOnly;
      }
      if (byteLength > 125) {
        throw new RangeError("The data size must not be greater than 125 bytes");
      }
      const options = {
        [kByteLength]: byteLength,
        fin: true,
        generateMask: this._generateMask,
        mask,
        maskBuffer: this._maskBuffer,
        opcode: 10,
        readOnly,
        rsv1: false
      };
      if (isBlob(data)) {
        if (this._state !== DEFAULT) {
          this.enqueue([this.getBlobData, data, false, options, cb]);
        } else {
          this.getBlobData(data, false, options, cb);
        }
      } else if (this._state !== DEFAULT) {
        this.enqueue([this.dispatch, data, false, options, cb]);
      } else {
        this.sendFrame(Sender.frame(data, options), cb);
      }
    }
    send(data, options, cb) {
      const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
      let opcode = options.binary ? 2 : 1;
      let rsv1 = options.compress;
      let byteLength;
      let readOnly;
      if (typeof data === "string") {
        byteLength = Buffer.byteLength(data);
        readOnly = false;
      } else if (isBlob(data)) {
        byteLength = data.size;
        readOnly = false;
      } else {
        data = toBuffer(data);
        byteLength = data.length;
        readOnly = toBuffer.readOnly;
      }
      if (this._firstFragment) {
        this._firstFragment = false;
        if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
          rsv1 = byteLength >= perMessageDeflate._threshold;
        }
        this._compress = rsv1;
      } else {
        rsv1 = false;
        opcode = 0;
      }
      if (options.fin)
        this._firstFragment = true;
      const opts = {
        [kByteLength]: byteLength,
        fin: options.fin,
        generateMask: this._generateMask,
        mask: options.mask,
        maskBuffer: this._maskBuffer,
        opcode,
        readOnly,
        rsv1
      };
      if (isBlob(data)) {
        if (this._state !== DEFAULT) {
          this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
        } else {
          this.getBlobData(data, this._compress, opts, cb);
        }
      } else if (this._state !== DEFAULT) {
        this.enqueue([this.dispatch, data, this._compress, opts, cb]);
      } else {
        this.dispatch(data, this._compress, opts, cb);
      }
    }
    getBlobData(blob, compress, options, cb) {
      this._bufferedBytes += options[kByteLength];
      this._state = GET_BLOB_DATA;
      blob.arrayBuffer().then((arrayBuffer) => {
        if (this._socket.destroyed) {
          const err = new Error("The socket was closed while the blob was being read");
          process.nextTick(callCallbacks, this, err, cb);
          return;
        }
        this._bufferedBytes -= options[kByteLength];
        const data = toBuffer(arrayBuffer);
        if (!compress) {
          this._state = DEFAULT;
          this.sendFrame(Sender.frame(data, options), cb);
          this.dequeue();
        } else {
          this.dispatch(data, compress, options, cb);
        }
      }).catch((err) => {
        process.nextTick(onError, this, err, cb);
      });
    }
    dispatch(data, compress, options, cb) {
      if (!compress) {
        this.sendFrame(Sender.frame(data, options), cb);
        return;
      }
      const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
      this._bufferedBytes += options[kByteLength];
      this._state = DEFLATING;
      perMessageDeflate.compress(data, options.fin, (_, buf) => {
        if (this._socket.destroyed) {
          const err = new Error("The socket was closed while data was being compressed");
          callCallbacks(this, err, cb);
          return;
        }
        this._bufferedBytes -= options[kByteLength];
        this._state = DEFAULT;
        options.readOnly = false;
        this.sendFrame(Sender.frame(buf, options), cb);
        this.dequeue();
      });
    }
    dequeue() {
      while (this._state === DEFAULT && this._queue.length) {
        const params = this._queue.shift();
        this._bufferedBytes -= params[3][kByteLength];
        Reflect.apply(params[0], this, params.slice(1));
      }
    }
    enqueue(params) {
      this._bufferedBytes += params[3][kByteLength];
      this._queue.push(params);
    }
    sendFrame(list, cb) {
      if (list.length === 2) {
        this._socket.cork();
        this._socket.write(list[0]);
        this._socket.write(list[1], cb);
        this._socket.uncork();
      } else {
        this._socket.write(list[0], cb);
      }
    }
  }
  module.exports = Sender;
  function callCallbacks(sender, err, cb) {
    if (typeof cb === "function")
      cb(err);
    for (let i = 0;i < sender._queue.length; i++) {
      const params = sender._queue[i];
      const callback = params[params.length - 1];
      if (typeof callback === "function")
        callback(err);
    }
  }
  function onError(sender, err, cb) {
    callCallbacks(sender, err, cb);
    sender.onerror(err);
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS(function(exports, module) {
  var { kForOnEventAttribute, kListener } = require_constants();
  var kCode = Symbol("kCode");
  var kData = Symbol("kData");
  var kError = Symbol("kError");
  var kMessage = Symbol("kMessage");
  var kReason = Symbol("kReason");
  var kTarget = Symbol("kTarget");
  var kType = Symbol("kType");
  var kWasClean = Symbol("kWasClean");

  class Event {
    constructor(type) {
      this[kTarget] = null;
      this[kType] = type;
    }
    get target() {
      return this[kTarget];
    }
    get type() {
      return this[kType];
    }
  }
  Object.defineProperty(Event.prototype, "target", { enumerable: true });
  Object.defineProperty(Event.prototype, "type", { enumerable: true });

  class CloseEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this[kCode] = options.code === undefined ? 0 : options.code;
      this[kReason] = options.reason === undefined ? "" : options.reason;
      this[kWasClean] = options.wasClean === undefined ? false : options.wasClean;
    }
    get code() {
      return this[kCode];
    }
    get reason() {
      return this[kReason];
    }
    get wasClean() {
      return this[kWasClean];
    }
  }
  Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
  Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
  Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });

  class ErrorEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this[kError] = options.error === undefined ? null : options.error;
      this[kMessage] = options.message === undefined ? "" : options.message;
    }
    get error() {
      return this[kError];
    }
    get message() {
      return this[kMessage];
    }
  }
  Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
  Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });

  class MessageEvent2 extends Event {
    constructor(type, options = {}) {
      super(type);
      this[kData] = options.data === undefined ? null : options.data;
    }
    get data() {
      return this[kData];
    }
  }
  Object.defineProperty(MessageEvent2.prototype, "data", { enumerable: true });
  var EventTarget = {
    addEventListener(type, handler, options = {}) {
      for (const listener of this.listeners(type)) {
        if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
          return;
        }
      }
      let wrapper;
      if (type === "message") {
        wrapper = function onMessage(data, isBinary) {
          const event = new MessageEvent2("message", {
            data: isBinary ? data : data.toString()
          });
          event[kTarget] = this;
          callListener(handler, this, event);
        };
      } else if (type === "close") {
        wrapper = function onClose(code, message) {
          const event = new CloseEvent("close", {
            code,
            reason: message.toString(),
            wasClean: this._closeFrameReceived && this._closeFrameSent
          });
          event[kTarget] = this;
          callListener(handler, this, event);
        };
      } else if (type === "error") {
        wrapper = function onError(error) {
          const event = new ErrorEvent("error", {
            error,
            message: error.message
          });
          event[kTarget] = this;
          callListener(handler, this, event);
        };
      } else if (type === "open") {
        wrapper = function onOpen() {
          const event = new Event("open");
          event[kTarget] = this;
          callListener(handler, this, event);
        };
      } else {
        return;
      }
      wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
      wrapper[kListener] = handler;
      if (options.once) {
        this.once(type, wrapper);
      } else {
        this.on(type, wrapper);
      }
    },
    removeEventListener(type, handler) {
      for (const listener of this.listeners(type)) {
        if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
          this.removeListener(type, listener);
          break;
        }
      }
    }
  };
  module.exports = {
    CloseEvent,
    ErrorEvent,
    Event,
    EventTarget,
    MessageEvent: MessageEvent2
  };
  function callListener(listener, thisArg, event) {
    if (typeof listener === "object" && listener.handleEvent) {
      listener.handleEvent.call(listener, event);
    } else {
      listener.call(thisArg, event);
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS(function(exports, module) {
  var { tokenChars } = require_validation();
  function push(dest, name, elem) {
    if (dest[name] === undefined)
      dest[name] = [elem];
    else
      dest[name].push(elem);
  }
  function parse(header) {
    const offers = Object.create(null);
    let params = Object.create(null);
    let mustUnescape = false;
    let isEscaping = false;
    let inQuotes = false;
    let extensionName;
    let paramName;
    let start = -1;
    let code = -1;
    let end = -1;
    let i = 0;
    for (;i < header.length; i++) {
      code = header.charCodeAt(i);
      if (extensionName === undefined) {
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1)
            start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1)
            end = i;
        } else if (code === 59 || code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1)
            end = i;
          const name = header.slice(start, end);
          if (code === 44) {
            push(offers, name, params);
            params = Object.create(null);
          } else {
            extensionName = name;
          }
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      } else if (paramName === undefined) {
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1)
            start = i;
        } else if (code === 32 || code === 9) {
          if (end === -1 && start !== -1)
            end = i;
        } else if (code === 59 || code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1)
            end = i;
          push(params, header.slice(start, end), true);
          if (code === 44) {
            push(offers, extensionName, params);
            params = Object.create(null);
            extensionName = undefined;
          }
          start = end = -1;
        } else if (code === 61 && start !== -1 && end === -1) {
          paramName = header.slice(start, i);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      } else {
        if (isEscaping) {
          if (tokenChars[code] !== 1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (start === -1)
            start = i;
          else if (!mustUnescape)
            mustUnescape = true;
          isEscaping = false;
        } else if (inQuotes) {
          if (tokenChars[code] === 1) {
            if (start === -1)
              start = i;
          } else if (code === 34 && start !== -1) {
            inQuotes = false;
            end = i;
          } else if (code === 92) {
            isEscaping = true;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
          inQuotes = true;
        } else if (end === -1 && tokenChars[code] === 1) {
          if (start === -1)
            start = i;
        } else if (start !== -1 && (code === 32 || code === 9)) {
          if (end === -1)
            end = i;
        } else if (code === 59 || code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1)
            end = i;
          let value = header.slice(start, end);
          if (mustUnescape) {
            value = value.replace(/\\/g, "");
            mustUnescape = false;
          }
          push(params, paramName, value);
          if (code === 44) {
            push(offers, extensionName, params);
            params = Object.create(null);
            extensionName = undefined;
          }
          paramName = undefined;
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
    }
    if (start === -1 || inQuotes || code === 32 || code === 9) {
      throw new SyntaxError("Unexpected end of input");
    }
    if (end === -1)
      end = i;
    const token = header.slice(start, end);
    if (extensionName === undefined) {
      push(offers, token, params);
    } else {
      if (paramName === undefined) {
        push(params, token, true);
      } else if (mustUnescape) {
        push(params, paramName, token.replace(/\\/g, ""));
      } else {
        push(params, paramName, token);
      }
      push(offers, extensionName, params);
    }
    return offers;
  }
  function format(extensions) {
    return Object.keys(extensions).map((extension) => {
      let configurations = extensions[extension];
      if (!Array.isArray(configurations))
        configurations = [configurations];
      return configurations.map((params) => {
        return [extension].concat(Object.keys(params).map((k) => {
          let values = params[k];
          if (!Array.isArray(values))
            values = [values];
          return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
        })).join("; ");
      }).join(", ");
    }).join(", ");
  }
  module.exports = { format, parse };
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS(function(exports, module) {
  var EventEmitter = __require("events");
  var https = __require("https");
  var http = __require("http");
  var net = __require("net");
  var tls = __require("tls");
  var { randomBytes, createHash } = __require("crypto");
  var { Duplex, Readable } = __require("stream");
  var { URL: URL2 } = __require("url");
  var PerMessageDeflate = require_permessage_deflate();
  var Receiver = require_receiver();
  var Sender = require_sender();
  var { isBlob } = require_validation();
  var {
    BINARY_TYPES,
    EMPTY_BUFFER,
    GUID,
    kForOnEventAttribute,
    kListener,
    kStatusCode,
    kWebSocket,
    NOOP
  } = require_constants();
  var {
    EventTarget: { addEventListener, removeEventListener }
  } = require_event_target();
  var { format, parse } = require_extension();
  var { toBuffer } = require_buffer_util();
  var closeTimeout = 30 * 1000;
  var kAborted = Symbol("kAborted");
  var protocolVersions = [8, 13];
  var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
  var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;

  class WebSocket extends EventEmitter {
    constructor(address, protocols, options) {
      super();
      this._binaryType = BINARY_TYPES[0];
      this._closeCode = 1006;
      this._closeFrameReceived = false;
      this._closeFrameSent = false;
      this._closeMessage = EMPTY_BUFFER;
      this._closeTimer = null;
      this._errorEmitted = false;
      this._extensions = {};
      this._paused = false;
      this._protocol = "";
      this._readyState = WebSocket.CONNECTING;
      this._receiver = null;
      this._sender = null;
      this._socket = null;
      if (address !== null) {
        this._bufferedAmount = 0;
        this._isServer = false;
        this._redirects = 0;
        if (protocols === undefined) {
          protocols = [];
        } else if (!Array.isArray(protocols)) {
          if (typeof protocols === "object" && protocols !== null) {
            options = protocols;
            protocols = [];
          } else {
            protocols = [protocols];
          }
        }
        initAsClient(this, address, protocols, options);
      } else {
        this._autoPong = options.autoPong;
        this._isServer = true;
      }
    }
    get binaryType() {
      return this._binaryType;
    }
    set binaryType(type) {
      if (!BINARY_TYPES.includes(type))
        return;
      this._binaryType = type;
      if (this._receiver)
        this._receiver._binaryType = type;
    }
    get bufferedAmount() {
      if (!this._socket)
        return this._bufferedAmount;
      return this._socket._writableState.length + this._sender._bufferedBytes;
    }
    get extensions() {
      return Object.keys(this._extensions).join();
    }
    get isPaused() {
      return this._paused;
    }
    get onclose() {
      return null;
    }
    get onerror() {
      return null;
    }
    get onopen() {
      return null;
    }
    get onmessage() {
      return null;
    }
    get protocol() {
      return this._protocol;
    }
    get readyState() {
      return this._readyState;
    }
    get url() {
      return this._url;
    }
    setSocket(socket, head, options) {
      const receiver = new Receiver({
        allowSynchronousEvents: options.allowSynchronousEvents,
        binaryType: this.binaryType,
        extensions: this._extensions,
        isServer: this._isServer,
        maxPayload: options.maxPayload,
        skipUTF8Validation: options.skipUTF8Validation
      });
      const sender = new Sender(socket, this._extensions, options.generateMask);
      this._receiver = receiver;
      this._sender = sender;
      this._socket = socket;
      receiver[kWebSocket] = this;
      sender[kWebSocket] = this;
      socket[kWebSocket] = this;
      receiver.on("conclude", receiverOnConclude);
      receiver.on("drain", receiverOnDrain);
      receiver.on("error", receiverOnError);
      receiver.on("message", receiverOnMessage);
      receiver.on("ping", receiverOnPing);
      receiver.on("pong", receiverOnPong);
      sender.onerror = senderOnError;
      if (socket.setTimeout)
        socket.setTimeout(0);
      if (socket.setNoDelay)
        socket.setNoDelay();
      if (head.length > 0)
        socket.unshift(head);
      socket.on("close", socketOnClose);
      socket.on("data", socketOnData);
      socket.on("end", socketOnEnd);
      socket.on("error", socketOnError);
      this._readyState = WebSocket.OPEN;
      this.emit("open");
    }
    emitClose() {
      if (!this._socket) {
        this._readyState = WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
        return;
      }
      if (this._extensions[PerMessageDeflate.extensionName]) {
        this._extensions[PerMessageDeflate.extensionName].cleanup();
      }
      this._receiver.removeAllListeners();
      this._readyState = WebSocket.CLOSED;
      this.emit("close", this._closeCode, this._closeMessage);
    }
    close(code, data) {
      if (this.readyState === WebSocket.CLOSED)
        return;
      if (this.readyState === WebSocket.CONNECTING) {
        const msg = "WebSocket was closed before the connection was established";
        abortHandshake(this, this._req, msg);
        return;
      }
      if (this.readyState === WebSocket.CLOSING) {
        if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
          this._socket.end();
        }
        return;
      }
      this._readyState = WebSocket.CLOSING;
      this._sender.close(code, data, !this._isServer, (err) => {
        if (err)
          return;
        this._closeFrameSent = true;
        if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
          this._socket.end();
        }
      });
      setCloseTimer(this);
    }
    pause() {
      if (this.readyState === WebSocket.CONNECTING || this.readyState === WebSocket.CLOSED) {
        return;
      }
      this._paused = true;
      this._socket.pause();
    }
    ping(data, mask, cb) {
      if (this.readyState === WebSocket.CONNECTING) {
        throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
      }
      if (typeof data === "function") {
        cb = data;
        data = mask = undefined;
      } else if (typeof mask === "function") {
        cb = mask;
        mask = undefined;
      }
      if (typeof data === "number")
        data = data.toString();
      if (this.readyState !== WebSocket.OPEN) {
        sendAfterClose(this, data, cb);
        return;
      }
      if (mask === undefined)
        mask = !this._isServer;
      this._sender.ping(data || EMPTY_BUFFER, mask, cb);
    }
    pong(data, mask, cb) {
      if (this.readyState === WebSocket.CONNECTING) {
        throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
      }
      if (typeof data === "function") {
        cb = data;
        data = mask = undefined;
      } else if (typeof mask === "function") {
        cb = mask;
        mask = undefined;
      }
      if (typeof data === "number")
        data = data.toString();
      if (this.readyState !== WebSocket.OPEN) {
        sendAfterClose(this, data, cb);
        return;
      }
      if (mask === undefined)
        mask = !this._isServer;
      this._sender.pong(data || EMPTY_BUFFER, mask, cb);
    }
    resume() {
      if (this.readyState === WebSocket.CONNECTING || this.readyState === WebSocket.CLOSED) {
        return;
      }
      this._paused = false;
      if (!this._receiver._writableState.needDrain)
        this._socket.resume();
    }
    send(data, options, cb) {
      if (this.readyState === WebSocket.CONNECTING) {
        throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
      }
      if (typeof options === "function") {
        cb = options;
        options = {};
      }
      if (typeof data === "number")
        data = data.toString();
      if (this.readyState !== WebSocket.OPEN) {
        sendAfterClose(this, data, cb);
        return;
      }
      const opts = {
        binary: typeof data !== "string",
        mask: !this._isServer,
        compress: true,
        fin: true,
        ...options
      };
      if (!this._extensions[PerMessageDeflate.extensionName]) {
        opts.compress = false;
      }
      this._sender.send(data || EMPTY_BUFFER, opts, cb);
    }
    terminate() {
      if (this.readyState === WebSocket.CLOSED)
        return;
      if (this.readyState === WebSocket.CONNECTING) {
        const msg = "WebSocket was closed before the connection was established";
        abortHandshake(this, this._req, msg);
        return;
      }
      if (this._socket) {
        this._readyState = WebSocket.CLOSING;
        this._socket.destroy();
      }
    }
  }
  Object.defineProperty(WebSocket, "CONNECTING", {
    enumerable: true,
    value: readyStates.indexOf("CONNECTING")
  });
  Object.defineProperty(WebSocket.prototype, "CONNECTING", {
    enumerable: true,
    value: readyStates.indexOf("CONNECTING")
  });
  Object.defineProperty(WebSocket, "OPEN", {
    enumerable: true,
    value: readyStates.indexOf("OPEN")
  });
  Object.defineProperty(WebSocket.prototype, "OPEN", {
    enumerable: true,
    value: readyStates.indexOf("OPEN")
  });
  Object.defineProperty(WebSocket, "CLOSING", {
    enumerable: true,
    value: readyStates.indexOf("CLOSING")
  });
  Object.defineProperty(WebSocket.prototype, "CLOSING", {
    enumerable: true,
    value: readyStates.indexOf("CLOSING")
  });
  Object.defineProperty(WebSocket, "CLOSED", {
    enumerable: true,
    value: readyStates.indexOf("CLOSED")
  });
  Object.defineProperty(WebSocket.prototype, "CLOSED", {
    enumerable: true,
    value: readyStates.indexOf("CLOSED")
  });
  [
    "binaryType",
    "bufferedAmount",
    "extensions",
    "isPaused",
    "protocol",
    "readyState",
    "url"
  ].forEach((property) => {
    Object.defineProperty(WebSocket.prototype, property, { enumerable: true });
  });
  ["open", "error", "close", "message"].forEach((method) => {
    Object.defineProperty(WebSocket.prototype, `on${method}`, {
      enumerable: true,
      get() {
        for (const listener of this.listeners(method)) {
          if (listener[kForOnEventAttribute])
            return listener[kListener];
        }
        return null;
      },
      set(handler) {
        for (const listener of this.listeners(method)) {
          if (listener[kForOnEventAttribute]) {
            this.removeListener(method, listener);
            break;
          }
        }
        if (typeof handler !== "function")
          return;
        this.addEventListener(method, handler, {
          [kForOnEventAttribute]: true
        });
      }
    });
  });
  WebSocket.prototype.addEventListener = addEventListener;
  WebSocket.prototype.removeEventListener = removeEventListener;
  module.exports = WebSocket;
  function initAsClient(websocket, address, protocols, options) {
    const opts = {
      allowSynchronousEvents: true,
      autoPong: true,
      protocolVersion: protocolVersions[1],
      maxPayload: 100 * 1024 * 1024,
      skipUTF8Validation: false,
      perMessageDeflate: true,
      followRedirects: false,
      maxRedirects: 10,
      ...options,
      socketPath: undefined,
      hostname: undefined,
      protocol: undefined,
      timeout: undefined,
      method: "GET",
      host: undefined,
      path: undefined,
      port: undefined
    };
    websocket._autoPong = opts.autoPong;
    if (!protocolVersions.includes(opts.protocolVersion)) {
      throw new RangeError(`Unsupported protocol version: ${opts.protocolVersion} ` + `(supported versions: ${protocolVersions.join(", ")})`);
    }
    let parsedUrl;
    if (address instanceof URL2) {
      parsedUrl = address;
    } else {
      try {
        parsedUrl = new URL2(address);
      } catch (e) {
        throw new SyntaxError(`Invalid URL: ${address}`);
      }
    }
    if (parsedUrl.protocol === "http:") {
      parsedUrl.protocol = "ws:";
    } else if (parsedUrl.protocol === "https:") {
      parsedUrl.protocol = "wss:";
    }
    websocket._url = parsedUrl.href;
    const isSecure = parsedUrl.protocol === "wss:";
    const isIpcUrl = parsedUrl.protocol === "ws+unix:";
    let invalidUrlMessage;
    if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
      invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", ` + '"http:", "https", or "ws+unix:"';
    } else if (isIpcUrl && !parsedUrl.pathname) {
      invalidUrlMessage = "The URL's pathname is empty";
    } else if (parsedUrl.hash) {
      invalidUrlMessage = "The URL contains a fragment identifier";
    }
    if (invalidUrlMessage) {
      const err = new SyntaxError(invalidUrlMessage);
      if (websocket._redirects === 0) {
        throw err;
      } else {
        emitErrorAndClose(websocket, err);
        return;
      }
    }
    const defaultPort = isSecure ? 443 : 80;
    const key = randomBytes(16).toString("base64");
    const request3 = isSecure ? https.request : http.request;
    const protocolSet = new Set;
    let perMessageDeflate;
    opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
    opts.defaultPort = opts.defaultPort || defaultPort;
    opts.port = parsedUrl.port || defaultPort;
    opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
    opts.headers = {
      ...opts.headers,
      "Sec-WebSocket-Version": opts.protocolVersion,
      "Sec-WebSocket-Key": key,
      Connection: "Upgrade",
      Upgrade: "websocket"
    };
    opts.path = parsedUrl.pathname + parsedUrl.search;
    opts.timeout = opts.handshakeTimeout;
    if (opts.perMessageDeflate) {
      perMessageDeflate = new PerMessageDeflate(opts.perMessageDeflate !== true ? opts.perMessageDeflate : {}, false, opts.maxPayload);
      opts.headers["Sec-WebSocket-Extensions"] = format({
        [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
      });
    }
    if (protocols.length) {
      for (const protocol of protocols) {
        if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
          throw new SyntaxError("An invalid or duplicated subprotocol was specified");
        }
        protocolSet.add(protocol);
      }
      opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
    }
    if (opts.origin) {
      if (opts.protocolVersion < 13) {
        opts.headers["Sec-WebSocket-Origin"] = opts.origin;
      } else {
        opts.headers.Origin = opts.origin;
      }
    }
    if (parsedUrl.username || parsedUrl.password) {
      opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
    }
    if (isIpcUrl) {
      const parts = opts.path.split(":");
      opts.socketPath = parts[0];
      opts.path = parts[1];
    }
    let req;
    if (opts.followRedirects) {
      if (websocket._redirects === 0) {
        websocket._originalIpc = isIpcUrl;
        websocket._originalSecure = isSecure;
        websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
        const headers = options && options.headers;
        options = { ...options, headers: {} };
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            options.headers[key.toLowerCase()] = value;
          }
        }
      } else if (websocket.listenerCount("redirect") === 0) {
        const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
        if (!isSameHost || websocket._originalSecure && !isSecure) {
          delete opts.headers.authorization;
          delete opts.headers.cookie;
          if (!isSameHost)
            delete opts.headers.host;
          opts.auth = undefined;
        }
      }
      if (opts.auth && !options.headers.authorization) {
        options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
      }
      req = websocket._req = request3(opts);
      if (websocket._redirects) {
        websocket.emit("redirect", websocket.url, req);
      }
    } else {
      req = websocket._req = request3(opts);
    }
    if (opts.timeout) {
      req.on("timeout", () => {
        abortHandshake(websocket, req, "Opening handshake has timed out");
      });
    }
    req.on("error", (err) => {
      if (req === null || req[kAborted])
        return;
      req = websocket._req = null;
      emitErrorAndClose(websocket, err);
    });
    req.on("response", (res) => {
      const location = res.headers.location;
      const statusCode = res.statusCode;
      if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
        if (++websocket._redirects > opts.maxRedirects) {
          abortHandshake(websocket, req, "Maximum redirects exceeded");
          return;
        }
        req.abort();
        let addr;
        try {
          addr = new URL2(location, address);
        } catch (e) {
          const err = new SyntaxError(`Invalid URL: ${location}`);
          emitErrorAndClose(websocket, err);
          return;
        }
        initAsClient(websocket, addr, protocols, options);
      } else if (!websocket.emit("unexpected-response", req, res)) {
        abortHandshake(websocket, req, `Unexpected server response: ${res.statusCode}`);
      }
    });
    req.on("upgrade", (res, socket, head) => {
      websocket.emit("upgrade", res);
      if (websocket.readyState !== WebSocket.CONNECTING)
        return;
      req = websocket._req = null;
      const upgrade = res.headers.upgrade;
      if (upgrade === undefined || upgrade.toLowerCase() !== "websocket") {
        abortHandshake(websocket, socket, "Invalid Upgrade header");
        return;
      }
      const digest = createHash("sha1").update(key + GUID).digest("base64");
      if (res.headers["sec-websocket-accept"] !== digest) {
        abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
        return;
      }
      const serverProt = res.headers["sec-websocket-protocol"];
      let protError;
      if (serverProt !== undefined) {
        if (!protocolSet.size) {
          protError = "Server sent a subprotocol but none was requested";
        } else if (!protocolSet.has(serverProt)) {
          protError = "Server sent an invalid subprotocol";
        }
      } else if (protocolSet.size) {
        protError = "Server sent no subprotocol";
      }
      if (protError) {
        abortHandshake(websocket, socket, protError);
        return;
      }
      if (serverProt)
        websocket._protocol = serverProt;
      const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
      if (secWebSocketExtensions !== undefined) {
        if (!perMessageDeflate) {
          const message = "Server sent a Sec-WebSocket-Extensions header but no extension " + "was requested";
          abortHandshake(websocket, socket, message);
          return;
        }
        let extensions;
        try {
          extensions = parse(secWebSocketExtensions);
        } catch (err) {
          const message = "Invalid Sec-WebSocket-Extensions header";
          abortHandshake(websocket, socket, message);
          return;
        }
        const extensionNames = Object.keys(extensions);
        if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate.extensionName) {
          const message = "Server indicated an extension that was not requested";
          abortHandshake(websocket, socket, message);
          return;
        }
        try {
          perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
        } catch (err) {
          const message = "Invalid Sec-WebSocket-Extensions header";
          abortHandshake(websocket, socket, message);
          return;
        }
        websocket._extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
      }
      websocket.setSocket(socket, head, {
        allowSynchronousEvents: opts.allowSynchronousEvents,
        generateMask: opts.generateMask,
        maxPayload: opts.maxPayload,
        skipUTF8Validation: opts.skipUTF8Validation
      });
    });
    if (opts.finishRequest) {
      opts.finishRequest(req, websocket);
    } else {
      req.end();
    }
  }
  function emitErrorAndClose(websocket, err) {
    websocket._readyState = WebSocket.CLOSING;
    websocket._errorEmitted = true;
    websocket.emit("error", err);
    websocket.emitClose();
  }
  function netConnect(options) {
    options.path = options.socketPath;
    return net.connect(options);
  }
  function tlsConnect(options) {
    options.path = undefined;
    if (!options.servername && options.servername !== "") {
      options.servername = net.isIP(options.host) ? "" : options.host;
    }
    return tls.connect(options);
  }
  function abortHandshake(websocket, stream, message) {
    websocket._readyState = WebSocket.CLOSING;
    const err = new Error(message);
    Error.captureStackTrace(err, abortHandshake);
    if (stream.setHeader) {
      stream[kAborted] = true;
      stream.abort();
      if (stream.socket && !stream.socket.destroyed) {
        stream.socket.destroy();
      }
      process.nextTick(emitErrorAndClose, websocket, err);
    } else {
      stream.destroy(err);
      stream.once("error", websocket.emit.bind(websocket, "error"));
      stream.once("close", websocket.emitClose.bind(websocket));
    }
  }
  function sendAfterClose(websocket, data, cb) {
    if (data) {
      const length = isBlob(data) ? data.size : toBuffer(data).length;
      if (websocket._socket)
        websocket._sender._bufferedBytes += length;
      else
        websocket._bufferedAmount += length;
    }
    if (cb) {
      const err = new Error(`WebSocket is not open: readyState ${websocket.readyState} ` + `(${readyStates[websocket.readyState]})`);
      process.nextTick(cb, err);
    }
  }
  function receiverOnConclude(code, reason) {
    const websocket = this[kWebSocket];
    websocket._closeFrameReceived = true;
    websocket._closeMessage = reason;
    websocket._closeCode = code;
    if (websocket._socket[kWebSocket] === undefined)
      return;
    websocket._socket.removeListener("data", socketOnData);
    process.nextTick(resume, websocket._socket);
    if (code === 1005)
      websocket.close();
    else
      websocket.close(code, reason);
  }
  function receiverOnDrain() {
    const websocket = this[kWebSocket];
    if (!websocket.isPaused)
      websocket._socket.resume();
  }
  function receiverOnError(err) {
    const websocket = this[kWebSocket];
    if (websocket._socket[kWebSocket] !== undefined) {
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      websocket.close(err[kStatusCode]);
    }
    if (!websocket._errorEmitted) {
      websocket._errorEmitted = true;
      websocket.emit("error", err);
    }
  }
  function receiverOnFinish() {
    this[kWebSocket].emitClose();
  }
  function receiverOnMessage(data, isBinary) {
    this[kWebSocket].emit("message", data, isBinary);
  }
  function receiverOnPing(data) {
    const websocket = this[kWebSocket];
    if (websocket._autoPong)
      websocket.pong(data, !this._isServer, NOOP);
    websocket.emit("ping", data);
  }
  function receiverOnPong(data) {
    this[kWebSocket].emit("pong", data);
  }
  function resume(stream) {
    stream.resume();
  }
  function senderOnError(err) {
    const websocket = this[kWebSocket];
    if (websocket.readyState === WebSocket.CLOSED)
      return;
    if (websocket.readyState === WebSocket.OPEN) {
      websocket._readyState = WebSocket.CLOSING;
      setCloseTimer(websocket);
    }
    this._socket.end();
    if (!websocket._errorEmitted) {
      websocket._errorEmitted = true;
      websocket.emit("error", err);
    }
  }
  function setCloseTimer(websocket) {
    websocket._closeTimer = setTimeout(websocket._socket.destroy.bind(websocket._socket), closeTimeout);
  }
  function socketOnClose() {
    const websocket = this[kWebSocket];
    this.removeListener("close", socketOnClose);
    this.removeListener("data", socketOnData);
    this.removeListener("end", socketOnEnd);
    websocket._readyState = WebSocket.CLOSING;
    let chunk;
    if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && (chunk = websocket._socket.read()) !== null) {
      websocket._receiver.write(chunk);
    }
    websocket._receiver.end();
    this[kWebSocket] = undefined;
    clearTimeout(websocket._closeTimer);
    if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
      websocket.emitClose();
    } else {
      websocket._receiver.on("error", receiverOnFinish);
      websocket._receiver.on("finish", receiverOnFinish);
    }
  }
  function socketOnData(chunk) {
    if (!this[kWebSocket]._receiver.write(chunk)) {
      this.pause();
    }
  }
  function socketOnEnd() {
    const websocket = this[kWebSocket];
    websocket._readyState = WebSocket.CLOSING;
    websocket._receiver.end();
    this.end();
  }
  function socketOnError() {
    const websocket = this[kWebSocket];
    this.removeListener("error", socketOnError);
    this.on("error", NOOP);
    if (websocket) {
      websocket._readyState = WebSocket.CLOSING;
      this.destroy();
    }
  }
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS(function(exports, module) {
  var { tokenChars } = require_validation();
  function parse(header) {
    const protocols = new Set;
    let start = -1;
    let end = -1;
    let i = 0;
    for (i;i < header.length; i++) {
      const code = header.charCodeAt(i);
      if (end === -1 && tokenChars[code] === 1) {
        if (start === -1)
          start = i;
      } else if (i !== 0 && (code === 32 || code === 9)) {
        if (end === -1 && start !== -1)
          end = i;
      } else if (code === 44) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
        if (end === -1)
          end = i;
        const protocol = header.slice(start, end);
        if (protocols.has(protocol)) {
          throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
        }
        protocols.add(protocol);
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    }
    if (start === -1 || end !== -1) {
      throw new SyntaxError("Unexpected end of input");
    }
    const protocol = header.slice(start, i);
    if (protocols.has(protocol)) {
      throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
    }
    protocols.add(protocol);
    return protocols;
  }
  module.exports = { parse };
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS(function(exports, module) {
  var EventEmitter = __require("events");
  var http = __require("http");
  var { Duplex } = __require("stream");
  var { createHash } = __require("crypto");
  var extension = require_extension();
  var PerMessageDeflate = require_permessage_deflate();
  var subprotocol = require_subprotocol();
  var WebSocket = require_websocket();
  var { GUID, kWebSocket } = require_constants();
  var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
  var RUNNING = 0;
  var CLOSING = 1;
  var CLOSED = 2;

  class WebSocketServer extends EventEmitter {
    constructor(options, callback) {
      super();
      options = {
        allowSynchronousEvents: true,
        autoPong: true,
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: false,
        handleProtocols: null,
        clientTracking: true,
        verifyClient: null,
        noServer: false,
        backlog: null,
        server: null,
        host: null,
        path: null,
        port: null,
        WebSocket,
        ...options
      };
      if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
        throw new TypeError('One and only one of the "port", "server", or "noServer" options ' + "must be specified");
      }
      if (options.port != null) {
        this._server = http.createServer((req, res) => {
          const body = http.STATUS_CODES[426];
          res.writeHead(426, {
            "Content-Length": body.length,
            "Content-Type": "text/plain"
          });
          res.end(body);
        });
        this._server.listen(options.port, options.host, options.backlog, callback);
      } else if (options.server) {
        this._server = options.server;
      }
      if (this._server) {
        const emitConnection = this.emit.bind(this, "connection");
        this._removeListeners = addListeners(this._server, {
          listening: this.emit.bind(this, "listening"),
          error: this.emit.bind(this, "error"),
          upgrade: (req, socket, head) => {
            this.handleUpgrade(req, socket, head, emitConnection);
          }
        });
      }
      if (options.perMessageDeflate === true)
        options.perMessageDeflate = {};
      if (options.clientTracking) {
        this.clients = new Set;
        this._shouldEmitClose = false;
      }
      this.options = options;
      this._state = RUNNING;
    }
    address() {
      if (this.options.noServer) {
        throw new Error('The server is operating in "noServer" mode');
      }
      if (!this._server)
        return null;
      return this._server.address();
    }
    close(cb) {
      if (this._state === CLOSED) {
        if (cb) {
          this.once("close", () => {
            cb(new Error("The server is not running"));
          });
        }
        process.nextTick(emitClose, this);
        return;
      }
      if (cb)
        this.once("close", cb);
      if (this._state === CLOSING)
        return;
      this._state = CLOSING;
      if (this.options.noServer || this.options.server) {
        if (this._server) {
          this._removeListeners();
          this._removeListeners = this._server = null;
        }
        if (this.clients) {
          if (!this.clients.size) {
            process.nextTick(emitClose, this);
          } else {
            this._shouldEmitClose = true;
          }
        } else {
          process.nextTick(emitClose, this);
        }
      } else {
        const server = this._server;
        this._removeListeners();
        this._removeListeners = this._server = null;
        server.close(() => {
          emitClose(this);
        });
      }
    }
    shouldHandle(req) {
      if (this.options.path) {
        const index = req.url.indexOf("?");
        const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
        if (pathname !== this.options.path)
          return false;
      }
      return true;
    }
    handleUpgrade(req, socket, head, cb) {
      socket.on("error", socketOnError);
      const key = req.headers["sec-websocket-key"];
      const upgrade = req.headers.upgrade;
      const version = +req.headers["sec-websocket-version"];
      if (req.method !== "GET") {
        const message = "Invalid HTTP method";
        abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
        return;
      }
      if (upgrade === undefined || upgrade.toLowerCase() !== "websocket") {
        const message = "Invalid Upgrade header";
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
        return;
      }
      if (key === undefined || !keyRegex.test(key)) {
        const message = "Missing or invalid Sec-WebSocket-Key header";
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
        return;
      }
      if (version !== 8 && version !== 13) {
        const message = "Missing or invalid Sec-WebSocket-Version header";
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
        return;
      }
      if (!this.shouldHandle(req)) {
        abortHandshake(socket, 400);
        return;
      }
      const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
      let protocols = new Set;
      if (secWebSocketProtocol !== undefined) {
        try {
          protocols = subprotocol.parse(secWebSocketProtocol);
        } catch (err) {
          const message = "Invalid Sec-WebSocket-Protocol header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
      }
      const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
      const extensions = {};
      if (this.options.perMessageDeflate && secWebSocketExtensions !== undefined) {
        const perMessageDeflate = new PerMessageDeflate(this.options.perMessageDeflate, true, this.options.maxPayload);
        try {
          const offers = extension.parse(secWebSocketExtensions);
          if (offers[PerMessageDeflate.extensionName]) {
            perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
            extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
          }
        } catch (err) {
          const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
      }
      if (this.options.verifyClient) {
        const info = {
          origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
          secure: !!(req.socket.authorized || req.socket.encrypted),
          req
        };
        if (this.options.verifyClient.length === 2) {
          this.options.verifyClient(info, (verified, code, message, headers) => {
            if (!verified) {
              return abortHandshake(socket, code || 401, message, headers);
            }
            this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
          });
          return;
        }
        if (!this.options.verifyClient(info))
          return abortHandshake(socket, 401);
      }
      this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
    }
    completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
      if (!socket.readable || !socket.writable)
        return socket.destroy();
      if (socket[kWebSocket]) {
        throw new Error("server.handleUpgrade() was called more than once with the same " + "socket, possibly due to a misconfiguration");
      }
      if (this._state > RUNNING)
        return abortHandshake(socket, 503);
      const digest = createHash("sha1").update(key + GUID).digest("base64");
      const headers = [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${digest}`
      ];
      const ws = new this.options.WebSocket(null, undefined, this.options);
      if (protocols.size) {
        const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
        if (protocol) {
          headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
          ws._protocol = protocol;
        }
      }
      if (extensions[PerMessageDeflate.extensionName]) {
        const params = extensions[PerMessageDeflate.extensionName].params;
        const value = extension.format({
          [PerMessageDeflate.extensionName]: [params]
        });
        headers.push(`Sec-WebSocket-Extensions: ${value}`);
        ws._extensions = extensions;
      }
      this.emit("headers", headers, req);
      socket.write(headers.concat(`\r
`).join(`\r
`));
      socket.removeListener("error", socketOnError);
      ws.setSocket(socket, head, {
        allowSynchronousEvents: this.options.allowSynchronousEvents,
        maxPayload: this.options.maxPayload,
        skipUTF8Validation: this.options.skipUTF8Validation
      });
      if (this.clients) {
        this.clients.add(ws);
        ws.on("close", () => {
          this.clients.delete(ws);
          if (this._shouldEmitClose && !this.clients.size) {
            process.nextTick(emitClose, this);
          }
        });
      }
      cb(ws, req);
    }
  }
  module.exports = WebSocketServer;
  function addListeners(server, map) {
    for (const event of Object.keys(map))
      server.on(event, map[event]);
    return function removeListeners() {
      for (const event of Object.keys(map)) {
        server.removeListener(event, map[event]);
      }
    };
  }
  function emitClose(server) {
    server._state = CLOSED;
    server.emit("close");
  }
  function socketOnError() {
    this.destroy();
  }
  function abortHandshake(socket, code, message, headers) {
    message = message || http.STATUS_CODES[code];
    headers = {
      Connection: "close",
      "Content-Type": "text/html",
      "Content-Length": Buffer.byteLength(message),
      ...headers
    };
    socket.once("finish", socket.destroy);
    socket.end(`HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join(`\r
`) + `\r
\r
` + message);
  }
  function abortHandshakeOrEmitwsClientError(server, req, socket, code, message) {
    if (server.listenerCount("wsClientError")) {
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
      server.emit("wsClientError", err, socket, req);
    } else {
      abortHandshake(socket, code, message);
    }
  }
});

// service/main.ts
import { rm as rm2 } from "node:fs/promises";
import http from "node:http";
// node_modules/@openchamber/sdk/dist/scrollbar-style.js
var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
function installGuestScrollbarActivity(doc) {
  const root = doc.documentElement;
  if (root.hasAttribute("data-oc-scrollbar-activity"))
    return;
  root.setAttribute("data-oc-scrollbar-activity", "");
  const timers = new WeakMap;
  doc.addEventListener("scroll", (event) => {
    const target = event.target === doc ? root : event.target;
    if (!(target instanceof Element))
      return;
    if (!target.hasAttribute("data-oc-scrolling"))
      target.setAttribute("data-oc-scrolling", "");
    const pending = timers.get(target);
    if (pending !== undefined)
      clearTimeout(pending);
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      target.removeAttribute("data-oc-scrolling");
    }, 1000));
  }, { capture: true, passive: true });
}
var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;
// node_modules/@openchamber/sdk/dist/manifest.js
var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);
// node_modules/@openchamber/sdk/dist/session-events.js
var GUEST_SESSION_EVENT_TYPES = [
  "turn-finished",
  "turn-failed",
  "permission-asked",
  "question-asked",
  "turn-started",
  "session-created",
  "session-archived",
  "session-deleted"
];
var SESSION_EVENTS_WIRE_VERSION = 1;
var SESSION_EVENTS_IDLE_MS = 10 * 60000;
var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);
var isGuestSessionEventType = (value) => EVENT_TYPES.has(value);
var readSessionEventRequest = (body) => {
  let wire;
  try {
    const parsed = JSON.parse(body);
    if (Object(parsed) !== parsed || parsed === null)
      return null;
    wire = parsed;
  } catch {
    return null;
  }
  const { v, requestId, event, content } = wire;
  if (v !== SESSION_EVENTS_WIRE_VERSION)
    return null;
  if (String(requestId) !== requestId || requestId.length === 0)
    return null;
  if (Object(event) !== event || event === undefined)
    return null;
  const { id, type, at, session, project, linked, permission, question } = event;
  if (String(id) !== id || id.length === 0)
    return null;
  if (String(type) !== type || !isGuestSessionEventType(type))
    return null;
  if (!Number.isFinite(at))
    return null;
  if (Object(session) !== session || session === undefined)
    return null;
  const sessionId = session.id;
  if (String(sessionId) !== sessionId || sessionId.length === 0)
    return null;
  const parentId = session.parentId;
  if (parentId !== null && (String(parentId) !== parentId || parentId.length === 0))
    return null;
  if (Object(project) !== project || project === undefined)
    return null;
  const directory = project.directory;
  if (directory !== null && (String(directory) !== directory || directory.length === 0))
    return null;
  if (!Array.isArray(linked))
    return null;
  const request = {
    v: SESSION_EVENTS_WIRE_VERSION,
    requestId,
    event: { id, type, at: Number(at), session: { id: sessionId, parentId }, project: { directory }, linked }
  };
  if (permission !== undefined) {
    if (Object(permission) !== permission)
      return null;
    const permissionRequestId = permission.requestId;
    if (String(permissionRequestId) !== permissionRequestId || permissionRequestId.length === 0)
      return null;
    request.event.permission = { requestId: permissionRequestId };
  }
  if (question !== undefined) {
    if (Object(question) !== question)
      return null;
    const { kind, id: questionId } = question;
    if (kind !== "form" && kind !== "page")
      return null;
    if (String(questionId) !== questionId || questionId.length === 0)
      return null;
    request.event.question = { kind, id: questionId };
  }
  if (content !== undefined) {
    if (Object(content) !== content || content.type !== type)
      return null;
    request.content = content;
  }
  return request;
};
// node_modules/@openchamber/sdk/dist/service-host.js
var SERVICE_HOST_PATH = "/service/call";
var OPENCHAMBER_HOST_CALLBACK_URL_ENV = "OPENCHAMBER_HOST_CALLBACK_URL";
var SERVICE_HOST_TIMEOUT_MS = 30000;
var SERVICE_SCHEDULE_IDLE_MS = 10 * 60000;
var MENTIONS_IDLE_MS = 10 * 60000;
class ServiceHostError extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "ServiceHostError";
    this.code = code;
    this.status = status;
  }
}
var createServiceHost = ({ env }) => {
  const call = async (method, input) => {
    const base = env[OPENCHAMBER_HOST_CALLBACK_URL_ENV];
    const token = env.OPENCHAMBER_SERVICE_TOKEN;
    if (!base || !token)
      throw new ServiceHostError("This service was not started by OpenChamber.", "HOST_UNAVAILABLE", 0);
    let response;
    try {
      response = await fetch(`${base.replace(/\/+$/, "")}${SERVICE_HOST_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method, input }),
        signal: AbortSignal.timeout(SERVICE_HOST_TIMEOUT_MS)
      });
    } catch {
      throw new ServiceHostError("OpenChamber did not answer.", "HOST_UNAVAILABLE", 0);
    }
    const body = await response.json().catch(() => null);
    if (response.ok && body?.result !== undefined)
      return body.result;
    throw new ServiceHostError(body?.error?.message ?? `OpenChamber answered HTTP ${response.status}.`, body?.error?.code ?? "HOST_UNAVAILABLE", response.status);
  };
  return {
    sessions: {
      start: (input) => call("sessions.start", input),
      send: (sessionId, prompt) => call("sessions.send", { sessionId, prompt }),
      retry: (sessionId) => call("sessions.retry", { sessionId }),
      status: (sessionId) => call("sessions.status", { sessionId }),
      lastReply: (sessionId) => call("sessions.lastReply", { sessionId }),
      stop: (sessionId) => call("sessions.stop", { sessionId }),
      answerPermission: (sessionId, requestId, answer) => call("sessions.answerPermission", { sessionId, requestId, ...answer }),
      answerForm: (sessionId, formId, values, message) => call("sessions.answerForm", { sessionId, formId, values, ...message === undefined ? {} : { message } })
    },
    setInstructions: (directory, text) => call("instructions.set", { directory, text }),
    emit: (topic, data) => call("panels.emit", { topic, data }),
    readSettings: () => call("settings.read", {}).then(({ settings }) => settings),
    needsConfiguration: (message) => call("status.set", { needsConfiguration: message }),
    setMark: (target, mark) => call("marks.set", { target, mark })
  };
};
// node_modules/@openchamber/sdk/dist/file-editor.js
var patternExpressions = new Map;
// node_modules/@openchamber/sdk/dist/contract.js
var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
var GUEST_GENERATE_LATE_KEEP_MS = 60 * 60000;
var HOST_REQUEST_ERROR_CODES = [
  "HOST_UNAVAILABLE",
  "HOST_TIMEOUT",
  "HOST_REJECTED",
  "DISCONNECTED",
  "DISABLED",
  "BAD_PATH",
  "NO_INTEGRATION",
  "NO_SERVICE",
  "SERVICE_FAILED",
  "REQUEST_FAILED",
  "RESPONSE_TOO_LARGE",
  "NO_SESSION",
  "SESSION_BUSY",
  "NOT_GRANTED",
  "NO_DIRECTORY",
  "NOT_FOUND",
  "FILE_TOO_LARGE",
  "DENIED",
  "NO_MODEL",
  "MODEL_FAILED",
  "UNSUPPORTED"
];
var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
var HOST_PUSH_TYPES = new Set([
  "workspace",
  "shells",
  "ready",
  "directory",
  "session",
  "connection",
  "settings",
  "session-lifecycle",
  "item",
  "resolve",
  "action",
  "service-event",
  "status-control-event",
  "popover-closed",
  "file-open",
  "file-snapshot",
  "file-saved",
  "generate-late",
  "microphone-audio",
  "microphone-ended"
]);
// node_modules/@openchamber/sdk/dist/service-providers.js
var BROWSER_CONTROL_ACTIONS = [
  "browser.open",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.inspect",
  "browser.capture",
  "browser.resize",
  "browser.close"
];
var BROWSER_PROVIDER_IDLE_MS = 10 * 60000;
var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 60000;
var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 60000;
var TRACKER_PROVIDER_IDLE_MS = 10 * 60000;
var QUOTA_PROVIDER_IDLE_MS = 10 * 60000;
// node_modules/@openchamber/sdk/dist/service-surface.js
var SURFACE_CONTROLLERS = ["none", "agent", "user"];
var CONTROLLERS = new Set(SURFACE_CONTROLLERS);
// service/bridge.ts
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path2 from "node:path";

// service/dingtalk/api.ts
import { randomUUID } from "node:crypto";

// service/dingtalk/types.ts
var TOPIC_ROBOT = "/v1.0/im/bot/messages/get";
var TOPIC_CARD = "/v1.0/card/instances/callback";
var DINGTALK_API_BASE = "https://api.dingtalk.com";
var DINGTALK_OAPI_BASE = "https://oapi.dingtalk.com";
var DEFAULT_CARD_TEMPLATE_ID = "02fcf2f4-5e02-4a85-b672-46d1f715543e.schema";
var CARD_FLOW_PROCESSING = "2";
var CARD_FLOW_FINISHED = "3";
var CARD_FLOW_FAILED = "5";
var REACTION_THINKING_NAME = "\uD83E\uDD14思考中";
var REACTION_DONE_NAME = "✅已完成";
var REACTION_TEXT_EMOTION_ID = "2659900";
var REACTION_TEXT_BACKGROUND_ID = "im_bg_1";
function splitDingTalkText(value, maxChars = 4000) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text)
    return [];
  if (!Number.isInteger(maxChars) || maxChars < 1)
    throw new TypeError("maxChars must be a positive integer");
  if (text.length <= maxChars)
    return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf(`
`, maxChars);
    if (splitAt < Math.floor(maxChars * 0.6))
      splitAt = maxChars;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, "");
  }
  if (remaining)
    chunks.push(remaining);
  return chunks;
}
function normalizeCardMarkdown(value) {
  const text = typeof value === "string" ? value.replace(/\r\n?/g, `
`) : "";
  const lines = text.split(`
`);
  let inCodeBlock = false;
  return lines.map((line, index) => {
    const fenced = /^\s{0,3}```/.test(line);
    const currentInCodeBlock = inCodeBlock;
    if (fenced)
      inCodeBlock = !inCodeBlock;
    if (index === lines.length - 1)
      return line;
    if (currentInCodeBlock || fenced || inCodeBlock || !line || !lines[index + 1])
      return `${line}
`;
    if (/^\s{0,3}(?:[-*+] |\d+[.)] |#{1,6} |\||> )/.test(lines[index + 1] ?? ""))
      return `${line}
`;
    return `${line}<br>`;
  }).join("");
}
function normalizeRobotCallback(payload) {
  const raw = payload;
  if (!raw || typeof raw !== "object")
    return;
  const id = nonEmpty(raw.msgId) ?? nonEmpty(raw.conversationId ?? "");
  const senderId = nonEmpty(raw.senderStaffId) ?? nonEmpty(raw.senderId);
  if (!id || !senderId)
    return;
  const conversationType = raw.conversationType === "2" ? "group" : "single";
  const target = {
    conversationType,
    conversationId: nonEmpty(raw.conversationId) ?? "",
    messageId: id,
    ...nonEmpty(raw.senderStaffId) ? { userId: nonEmpty(raw.senderStaffId) } : {},
    ...conversationType === "group" && nonEmpty(raw.conversationId) ? { openConversationId: nonEmpty(raw.conversationId) } : {},
    ...nonEmpty(raw.sessionWebhook) ? { sessionWebhook: nonEmpty(raw.sessionWebhook) } : {},
    ...typeof raw.sessionWebhookExpiredTime === "number" ? { sessionWebhookExpiresAt: raw.sessionWebhookExpiredTime } : {}
  };
  const { text, attachment } = extractBody(raw);
  return {
    id,
    senderId,
    ...nonEmpty(raw.senderNick) ? { senderNick: nonEmpty(raw.senderNick) } : {},
    createdAt: typeof raw.createAt === "number" && Number.isFinite(raw.createAt) ? raw.createAt : Date.now(),
    ...text ? { text } : {},
    ...attachment ? { attachment } : {},
    target,
    raw
  };
}
function nonEmpty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function stripMention(text) {
  return text.replace(/^@\S+\s+/u, "").trim();
}
function extractBody(raw) {
  const msgtype = nonEmpty(raw.msgtype) ?? "";
  const content = raw.content ?? {};
  if (msgtype === "text") {
    const text = nonEmpty(raw.text?.content);
    return text ? { text: stripMention(text) } : {};
  }
  if (msgtype === "richText") {
    const parts = [];
    let attachment;
    for (const piece of content.richText ?? []) {
      const pieceText = nonEmpty(piece?.text);
      if (pieceText)
        parts.push(pieceText);
      const code = nonEmpty(piece?.downloadCode);
      if (code && !attachment) {
        attachment = { kind: piece?.type === "picture" ? "image" : "file", downloadCode: code };
      }
    }
    const text = stripMention(parts.join(`
`));
    return {
      ...text ? { text } : {},
      ...attachment ? { attachment } : {}
    };
  }
  if (msgtype === "picture") {
    const code = nonEmpty(content.downloadCode) ?? nonEmpty(content.pictureDownloadCode);
    return code ? { attachment: { kind: "image", downloadCode: code } } : {};
  }
  if (msgtype === "file") {
    const code = nonEmpty(content.downloadCode);
    return code ? {
      attachment: {
        kind: "file",
        downloadCode: code,
        ...nonEmpty(content.fileName) ? { fileName: nonEmpty(content.fileName) } : {},
        ...typeof content.fileSize === "number" ? { sizeBytes: content.fileSize } : {}
      }
    } : {};
  }
  if (msgtype === "audio" || msgtype === "voice") {
    const transcript = nonEmpty(content.recognition);
    const code = nonEmpty(content.downloadCode);
    if (transcript)
      return { text: transcript };
    return code ? { attachment: { kind: "audio", downloadCode: code } } : {};
  }
  if (msgtype === "video") {
    const code = nonEmpty(content.downloadCode);
    return code ? { attachment: { kind: "video", downloadCode: code } } : {};
  }
  return {};
}

// service/dingtalk/api.ts
var DEFAULT_TIMEOUT_MS = 15000;
var UPLOAD_TIMEOUT_MS = 60000;
var REACTION_TIMEOUT_MS = 5000;
var CARD_MIN_INTERVAL_MS = 50;
var CARD_BACKOFF_MS = 1000;

class DingTalkApiError extends Error {
  code;
  status;
  providerCode;
  constructor(code, message, options = {}) {
    super(message);
    this.name = "DingTalkApiError";
    this.code = code;
    this.status = options.status;
    this.providerCode = options.providerCode;
    if (options.cause !== undefined)
      this.cause = options.cause;
  }
}
function isAuthError(error) {
  if (!(error instanceof DingTalkApiError))
    return false;
  if (error.status === 401 || error.status === 403)
    return true;
  return error.providerCode === "InvalidAuthentication" || error.providerCode === "Forbidden.AccessDenied.AccessTokenPermissionDenied" || error.providerCode === "invalid_app_key_or_app_secret";
}
function isRateLimitError(error) {
  return error instanceof DingTalkApiError && (error.status === 429 || error.providerCode === "Throttling");
}
function isTransientError(error) {
  if (!(error instanceof DingTalkApiError))
    return false;
  if (error.code === "timeout" || error.code === "network-error" || error.code === "invalid-response")
    return true;
  return typeof error.status === "number" && error.status >= 500;
}
function nonEmpty2(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function isDingTalkHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "dingtalk.com" || host.endsWith(".dingtalk.com");
}
function normalizeSessionWebhook(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new DingTalkApiError("invalid-session-webhook", "钉钉回复地址无效。");
  }
  if (url.protocol !== "https:" || !isDingTalkHost(url.hostname) || url.username || url.password) {
    throw new DingTalkApiError("invalid-session-webhook", "钉钉回复地址不受信任。");
  }
  url.hash = "";
  return url.toString();
}
function abortError(signal) {
  return signal.reason instanceof Error ? signal.reason : new Error("aborted");
}
function delay(ms, signal) {
  if (ms <= 0)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal ? abortError(signal) : new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function normalizeCardTarget(target, robotCode) {
  if (target?.type === "group") {
    const openConversationId = nonEmpty2(target.openConversationId);
    if (!openConversationId)
      throw new DingTalkApiError("invalid-target", "钉钉群会话 id 缺失。");
    return { type: "group", openConversationId, robotCode };
  }
  const userId = nonEmpty2(target?.userId);
  if (!userId)
    throw new DingTalkApiError("invalid-target", "钉钉用户 id 缺失。");
  return { type: "user", userId, robotCode };
}
function cardDeliverBody(cardInstanceId, target) {
  const base = { outTrackId: cardInstanceId, userIdType: 1 };
  if (target.type === "group") {
    return {
      ...base,
      openSpaceId: `dtv1.card//IM_GROUP.${target.openConversationId ?? ""}`,
      imGroupOpenDeliverModel: { robotCode: target.robotCode, atUserIds: target.atUserIds }
    };
  }
  return {
    ...base,
    openSpaceId: `dtv1.card//IM_ROBOT.${target.userId ?? ""}`,
    imRobotOpenDeliverModel: {
      spaceType: "IM_ROBOT",
      robotCode: target.robotCode,
      extension: { dynamicSummary: "true" }
    }
  };
}
function cardData(text, flowStatus) {
  const markdown = normalizeCardMarkdown(text);
  return {
    cardParamMap: {
      flowStatus,
      msgContent: markdown,
      staticMsgContent: "",
      sys_full_json_obj: JSON.stringify({ order: ["msgContent"] }),
      config: JSON.stringify({ autoLayout: true })
    }
  };
}
function rejectedProviderResponse(value) {
  if (!value || typeof value !== "object")
    return;
  const record = value;
  for (const field of ["errcode", "code"]) {
    const fieldValue = record[field];
    if (fieldValue !== undefined && fieldValue !== 0 && fieldValue !== "0") {
      return typeof fieldValue === "string" || typeof fieldValue === "number" ? String(fieldValue) : "rejected";
    }
  }
  return;
}
function createDingTalkApi(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const logger = options.logger ?? console;
  const apiBase = (options.apiBase ?? DINGTALK_API_BASE).replace(/\/+$/, "");
  const oapiBase = (options.oapiBase ?? DINGTALK_OAPI_BASE).replace(/\/+$/, "");
  const cardMinIntervalMs = options.cardMinIntervalMs ?? CARD_MIN_INTERVAL_MS;
  const tokenCache = new Map;
  const tokenRequests = new Map;
  let nextCardRequestAt = 0;
  let cardSlotTail = Promise.resolve();
  async function requestJson(url, opts = {}) {
    const controller = new AbortController;
    const { signal } = opts;
    let timedOut = false;
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted)
      throw abortError(signal);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timer.unref?.();
    try {
      const response = await fetchImpl(url, {
        method: opts.method ?? "POST",
        redirect: "error",
        headers: { "content-type": "application/json", ...opts.headers },
        ...opts.body === undefined ? {} : { body: JSON.stringify(opts.body) },
        signal: controller.signal
      });
      if (!response.ok) {
        let providerCode;
        try {
          const errorBody = await response.json();
          providerCode = nonEmpty2(errorBody.code) ?? nonEmpty2(errorBody.errcode);
        } catch {}
        throw new DingTalkApiError("http-error", `钉钉服务请求失败（HTTP ${response.status}）。`, { status: response.status, ...providerCode ? { providerCode } : {} });
      }
      try {
        return await response.json();
      } catch (error) {
        throw new DingTalkApiError("invalid-response", "钉钉服务返回了无法解析的响应。", { cause: error });
      }
    } catch (error) {
      if (signal?.aborted)
        throw abortError(signal);
      if (timedOut)
        throw new DingTalkApiError("timeout", "钉钉服务请求超时。", { cause: error });
      if (error instanceof DingTalkApiError)
        throw error;
      throw new DingTalkApiError("network-error", `暂时无法完成钉钉${opts.action ?? "请求"}。`, { cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  async function requestMultipart(url, body, signal) {
    const controller = new AbortController;
    let timedOut = false;
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted)
      throw abortError(signal);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, UPLOAD_TIMEOUT_MS);
    timer.unref?.();
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        body,
        signal: controller.signal,
        redirect: "error"
      });
      let value = {};
      let parseError;
      try {
        value = await response.json();
      } catch (error) {
        parseError = error;
      }
      if (!response.ok) {
        const providerCode = nonEmpty2(value.code) ?? nonEmpty2(value.errcode);
        throw new DingTalkApiError("http-error", `钉钉上传失败（HTTP ${response.status}）。`, { status: response.status, ...providerCode ? { providerCode } : {} });
      }
      if (parseError) {
        throw new DingTalkApiError("invalid-response", "钉钉上传返回了无法解析的响应。", { cause: parseError });
      }
      return value;
    } catch (error) {
      if (signal?.aborted)
        throw abortError(signal);
      if (timedOut)
        throw new DingTalkApiError("timeout", "钉钉上传超时。", { cause: error });
      if (error instanceof DingTalkApiError)
        throw error;
      throw new DingTalkApiError("network-error", "暂时无法完成钉钉上传。", { cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  async function accessToken(credentials, signal) {
    const appKey = nonEmpty2(credentials?.clientId);
    const appSecret = nonEmpty2(credentials?.clientSecret);
    if (!appKey || !appSecret)
      throw new DingTalkApiError("invalid-access-token", "钉钉凭据缺失。");
    const cached = tokenCache.get(appKey);
    if (cached && cached.expiresAt > now())
      return cached.token;
    const inflight = tokenRequests.get(appKey);
    if (inflight)
      return inflight;
    const request = (async () => {
      const value = await requestJson(`${apiBase}/v1.0/oauth2/accessToken`, {
        body: { appKey, appSecret },
        signal,
        action: "鉴权"
      });
      const token = nonEmpty2(value.accessToken);
      if (!token)
        throw new DingTalkApiError("invalid-access-token", "钉钉服务没有返回访问令牌。");
      const expireIn = Number(value.expireIn ?? value.expiresIn);
      const lifetimeMs = Number.isFinite(expireIn) && expireIn > 0 ? (expireIn - 60) * 1000 : 7000000;
      tokenCache.set(appKey, { token, expiresAt: now() + Math.max(1000, lifetimeMs) });
      return token;
    })();
    const shared = request.finally(() => tokenRequests.delete(appKey));
    tokenRequests.set(appKey, shared);
    return shared;
  }
  async function cardRequest(pathname, opts) {
    const acquire = async () => {
      const waitMs = Math.max(0, nextCardRequestAt - now());
      if (waitMs > 0)
        await delay(waitMs, opts.signal);
      nextCardRequestAt = Math.max(nextCardRequestAt, now()) + cardMinIntervalMs;
    };
    const slot = cardSlotTail.then(acquire, acquire);
    cardSlotTail = slot.catch(() => {
      return;
    });
    await slot;
    try {
      return await requestJson(`${apiBase}/${pathname}`, opts);
    } catch (error) {
      if (!(error instanceof DingTalkApiError) || error.status !== 403)
        throw error;
      await delay(CARD_BACKOFF_MS, opts.signal);
      return requestJson(`${apiBase}/${pathname}`, opts);
    }
  }
  async function sendSessionText(opts) {
    const content = nonEmpty2(opts.text);
    if (!content)
      throw new TypeError("text is required");
    const webhook = normalizeSessionWebhook(opts.sessionWebhook);
    const token = await accessToken(opts.credentials, opts.signal);
    const body = opts.markdown ? { msgtype: "markdown", markdown: { title: "OpenChamber", text: content } } : { msgtype: "text", text: { content } };
    const response = await requestJson(webhook, {
      body: {
        ...body,
        ...opts.atUserIds && opts.atUserIds.length > 0 ? { at: { atUserIds: opts.atUserIds } } : {}
      },
      headers: { "x-acs-dingtalk-access-token": token },
      signal: opts.signal,
      action: "回复消息"
    });
    const rejection = rejectedProviderResponse(response);
    if (rejection) {
      throw new DingTalkApiError("send-rejected", "钉钉服务拒绝了回复消息。", { providerCode: rejection });
    }
  }
  async function sendRobotText(opts) {
    const content = nonEmpty2(opts.text);
    if (!content)
      throw new TypeError("text is required");
    const token = await accessToken(opts.credentials, opts.signal);
    const pathname = opts.target.type === "group" ? "v1.0/robot/groupMessages/send" : "v1.0/robot/oToMessages/batchSend";
    const response = await requestJson(`${apiBase}/${pathname}`, {
      body: {
        robotCode: opts.target.robotCode,
        msgKey: opts.markdown ? "sampleMarkdown" : "sampleText",
        msgParam: JSON.stringify(opts.markdown ? { title: "OpenChamber", text: content } : { content }),
        ...opts.target.type === "group" ? { openConversationId: opts.target.openConversationId } : { userIds: [opts.target.userId] }
      },
      headers: { "x-acs-dingtalk-access-token": token },
      signal: opts.signal,
      action: "主动文字消息发送"
    });
    const rejection = rejectedProviderResponse(response);
    if (rejection) {
      throw new DingTalkApiError("send-rejected", "钉钉服务拒绝了主动文字消息。", { providerCode: rejection });
    }
  }
  async function uploadMedia(opts) {
    const token = await accessToken(opts.credentials, opts.signal);
    const url = new URL(`${oapiBase}/media/upload`);
    url.searchParams.set("access_token", token);
    url.searchParams.set("type", opts.uploadType);
    const form = new FormData;
    form.append("media", new Blob([opts.bytes], { type: opts.mediaType ?? "application/octet-stream" }), opts.fileName);
    const uploaded = await requestMultipart(url, form, opts.signal);
    const rejection = rejectedProviderResponse(uploaded);
    const mediaId = nonEmpty2(uploaded.media_id);
    if (rejection || !mediaId) {
      throw new DingTalkApiError("upload-rejected", "钉钉服务拒绝了文件上传。", {
        ...rejection ? { providerCode: rejection } : { providerCode: "missing-media-id" }
      });
    }
    return mediaId;
  }
  async function sendFile(opts) {
    const mediaId = await uploadMedia({ ...opts, uploadType: "file" });
    const token = await accessToken(opts.credentials, opts.signal);
    const pathname = opts.target.type === "group" ? "v1.0/robot/groupMessages/send" : "v1.0/robot/oToMessages/batchSend";
    const extension = opts.fileName.includes(".") ? opts.fileName.split(".").pop()?.toLowerCase() ?? "file" : "file";
    const response = await requestJson(`${apiBase}/${pathname}`, {
      body: {
        robotCode: opts.target.robotCode,
        msgKey: "sampleFile",
        msgParam: JSON.stringify({ mediaId, fileName: opts.fileName, fileType: extension }),
        ...opts.target.type === "group" ? { openConversationId: opts.target.openConversationId } : { userIds: [opts.target.userId] }
      },
      headers: { "x-acs-dingtalk-access-token": token },
      signal: opts.signal,
      action: "文件消息发送"
    });
    const rejection = rejectedProviderResponse(response);
    if (rejection) {
      throw new DingTalkApiError("send-rejected", "钉钉服务拒绝了文件消息。", { providerCode: rejection });
    }
  }
  async function sendImage(opts) {
    const mediaId = await uploadMedia({ ...opts, uploadType: "image" });
    const token = await accessToken(opts.credentials, opts.signal);
    const pathname = opts.target.type === "group" ? "v1.0/robot/groupMessages/send" : "v1.0/robot/oToMessages/batchSend";
    const response = await requestJson(`${apiBase}/${pathname}`, {
      body: {
        robotCode: opts.target.robotCode,
        msgKey: "sampleImageMsg",
        msgParam: JSON.stringify({ photoURL: mediaId }),
        ...opts.target.type === "group" ? { openConversationId: opts.target.openConversationId } : { userIds: [opts.target.userId] }
      },
      headers: { "x-acs-dingtalk-access-token": token },
      signal: opts.signal,
      action: "图片消息发送"
    });
    const rejection = rejectedProviderResponse(response);
    if (rejection) {
      throw new DingTalkApiError("send-rejected", "钉钉服务拒绝了图片消息。", { providerCode: rejection });
    }
  }
  async function resolveDownloadUrl(opts) {
    const token = await accessToken(opts.credentials, opts.signal);
    const response = await requestJson(`${apiBase}/v1.0/robot/messageFiles/download`, {
      body: { downloadCode: opts.downloadCode, robotCode: opts.robotCode },
      headers: { "x-acs-dingtalk-access-token": token },
      signal: opts.signal,
      action: "附件下载地址"
    });
    const raw = nonEmpty2(response.downloadUrl);
    if (!raw)
      throw new DingTalkApiError("download-failed", "钉钉服务没有返回附件下载地址。");
    let url;
    try {
      url = new URL(raw);
    } catch (error) {
      throw new DingTalkApiError("download-failed", "钉钉服务返回了无效的附件下载地址。", { cause: error });
    }
    if (url.protocol === "http:" && (!url.port || url.port === "80")) {
      url.protocol = "https:";
      url.port = "";
    }
    if (url.protocol !== "https:") {
      throw new DingTalkApiError("download-failed", "钉钉附件下载地址不受信任。");
    }
    return url;
  }
  async function downloadAttachment(opts) {
    const url = await resolveDownloadUrl(opts);
    const controller = new AbortController;
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    timer.unref?.();
    const onAbort = () => controller.abort(opts.signal?.reason);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal
      });
      if (!response.ok) {
        throw new DingTalkApiError("download-failed", `钉钉附件下载失败（HTTP ${response.status}）。`, {
          status: response.status
        });
      }
      const length = Number(response.headers.get("content-length"));
      if (opts.maxBytes !== undefined && Number.isFinite(length) && length > opts.maxBytes) {
        throw new DingTalkApiError("download-failed", `钉钉附件超过 ${opts.maxBytes} 字节上限。`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (opts.maxBytes !== undefined && bytes.length > opts.maxBytes) {
        throw new DingTalkApiError("download-failed", `钉钉附件超过 ${opts.maxBytes} 字节上限。`);
      }
      return {
        bytes,
        contentType: response.headers.get("content-type") ?? "application/octet-stream"
      };
    } catch (error) {
      if (error instanceof DingTalkApiError)
        throw error;
      throw new DingTalkApiError("download-failed", "钉钉附件下载失败。", { cause: error });
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
  async function createAiCard(opts) {
    const content = nonEmpty2(opts.text);
    if (!content)
      throw new TypeError("text is required");
    const target = normalizeCardTarget(opts.target, opts.robotCode);
    const token = await accessToken(opts.credentials, opts.signal);
    const cardInstanceId = `oc_${randomUUID()}`;
    const headers = { "x-acs-dingtalk-access-token": token };
    const cardTemplateId = nonEmpty2(opts.cardTemplateId) ?? DEFAULT_CARD_TEMPLATE_ID;
    try {
      await cardRequest("v1.0/card/instances/createAndDeliver", {
        body: {
          ...cardDeliverBody(cardInstanceId, target),
          cardTemplateId,
          outTrackId: cardInstanceId,
          cardData: cardData(content, CARD_FLOW_PROCESSING),
          callbackType: "STREAM",
          ...target.type === "group" && target.atUserIds ? { cardAtUserIds: Object.keys(target.atUserIds) } : {},
          ...target.type === "group" ? { imGroupOpenSpaceModel: { supportForward: true } } : { imRobotOpenSpaceModel: { supportForward: true } }
        },
        headers,
        signal: opts.signal,
        action: "AI 卡片创建"
      });
      try {
        await cardRequest("v1.0/card/streaming", {
          method: "PUT",
          body: {
            outTrackId: cardInstanceId,
            guid: randomUUID(),
            key: "msgContent",
            content: normalizeCardMarkdown(content).replace(/\n+$/, ""),
            isFull: true,
            isFinalize: false,
            isError: false
          },
          headers,
          signal: opts.signal,
          action: "AI 卡片启动"
        });
      } catch (error) {
        if (opts.signal?.aborted)
          throw error;
        logger.warn("[钉钉] AI 卡片启动时首帧未送达");
      }
    } catch (error) {
      await failAiCard({
        credentials: opts.credentials,
        robotCode: opts.robotCode,
        cardInstanceId,
        text: "卡片已结束，请查看后续消息。",
        target: opts.target,
        signal: AbortSignal.timeout(5000)
      }).catch(() => {
        return;
      });
      throw error;
    }
    return { cardInstanceId };
  }
  async function updateAiCard(opts) {
    const content = nonEmpty2(opts.text);
    if (!content)
      throw new TypeError("text is required");
    normalizeCardTarget(opts.target, opts.robotCode);
    const token = await accessToken(opts.credentials, opts.signal);
    await cardRequest("v1.0/card/streaming", {
      method: "PUT",
      body: {
        outTrackId: opts.cardInstanceId,
        guid: randomUUID(),
        key: "msgContent",
        content: normalizeCardMarkdown(content).replace(/\n+$/, ""),
        isFull: true,
        isFinalize: false,
        isError: false
      },
      headers: { "x-acs-dingtalk-access-token": token },
      signal: opts.signal,
      action: "AI 卡片更新"
    });
  }
  async function finishAiCard(opts) {
    const content = nonEmpty2(opts.text);
    if (!content)
      throw new TypeError("text is required");
    normalizeCardTarget(opts.target, opts.robotCode);
    const token = await accessToken(opts.credentials, opts.signal);
    const headers = { "x-acs-dingtalk-access-token": token };
    await cardRequest("v1.0/card/streaming", {
      method: "PUT",
      body: {
        outTrackId: opts.cardInstanceId,
        guid: randomUUID(),
        key: "msgContent",
        content: normalizeCardMarkdown(content),
        isFull: true,
        isFinalize: true,
        isError: false
      },
      headers,
      signal: opts.signal,
      action: "AI 卡片完成"
    });
    await cardRequest("v1.0/card/instances", {
      method: "PUT",
      body: {
        outTrackId: opts.cardInstanceId,
        cardData: cardData(content, CARD_FLOW_FINISHED),
        cardUpdateOptions: { updateCardDataByKey: true }
      },
      headers,
      signal: opts.signal,
      action: "AI 卡片完成状态"
    });
  }
  async function failAiCard(opts) {
    const content = nonEmpty2(opts.text);
    if (!content)
      throw new TypeError("text is required");
    const token = await accessToken(opts.credentials, opts.signal);
    const headers = { "x-acs-dingtalk-access-token": token };
    const [streamed] = await Promise.allSettled([
      cardRequest("v1.0/card/streaming", {
        method: "PUT",
        body: {
          outTrackId: opts.cardInstanceId,
          guid: randomUUID(),
          key: "msgContent",
          content: normalizeCardMarkdown(content),
          isFull: true,
          isFinalize: false,
          isError: true
        },
        headers,
        signal: opts.signal,
        action: "AI 卡片失败收口"
      }),
      cardRequest("v1.0/card/instances", {
        method: "PUT",
        body: {
          outTrackId: opts.cardInstanceId,
          cardData: cardData(content, CARD_FLOW_FAILED),
          cardUpdateOptions: { updateCardDataByKey: true }
        },
        headers,
        signal: opts.signal,
        action: "AI 卡片失败状态"
      })
    ]);
    if (streamed.status === "rejected")
      throw streamed.reason;
  }
  async function changeReaction(opts, action) {
    const token = await accessToken(opts.credentials, opts.signal);
    const response = await requestJson(`${apiBase}/v1.0/robot/emotion/${action}`, {
      body: {
        robotCode: opts.robotCode,
        openMsgId: opts.messageId,
        openConversationId: opts.conversationId,
        emotionType: 2,
        emotionName: opts.reactionName,
        textEmotion: {
          emotionId: REACTION_TEXT_EMOTION_ID,
          emotionName: opts.reactionName,
          text: opts.reactionName,
          backgroundId: REACTION_TEXT_BACKGROUND_ID
        }
      },
      headers: { "x-acs-dingtalk-access-token": token },
      signal: opts.signal,
      timeoutMs: REACTION_TIMEOUT_MS,
      action: action === "reply" ? "消息状态添加" : "消息状态撤回"
    });
    const rejected = response.success === false ? nonEmpty2(response.code) ?? "rejected" : rejectedProviderResponse(response);
    if (rejected) {
      throw new DingTalkApiError("send-rejected", "钉钉服务拒绝了消息状态请求。", { providerCode: rejected });
    }
  }
  return {
    accessToken,
    sendSessionText,
    sendRobotText,
    sendFile,
    sendImage,
    uploadMedia,
    resolveDownloadUrl,
    downloadAttachment,
    createAiCard,
    updateAiCard,
    finishAiCard,
    failAiCard,
    addReaction: (opts) => changeReaction(opts, "reply"),
    recallReaction: (opts) => changeReaction(opts, "recall"),
    clearAccessToken(clientId) {
      if (clientId)
        tokenCache.delete(clientId);
      else
        tokenCache.clear();
    }
  };
}

// service/dingtalk/card.ts
var DEFAULT_UPDATE_INTERVAL_MS = 500;
var DEFAULT_FINALIZE_TIMEOUT_MS = 5000;
var CARD_CLOSED_TEXT = "卡片已结束，请查看后续消息。";

class DingTalkCardStream {
  options;
  log;
  now;
  updateIntervalMs;
  phase;
  cardInstanceId = null;
  pendingText = null;
  scheduledUpdate = null;
  updateWorker = null;
  finishPromise = null;
  lastUpdateAt = 0;
  onAbort;
  constructor(options) {
    this.options = options;
    this.log = options.logger ?? console;
    this.now = options.now ?? (() => Date.now());
    this.updateIntervalMs = options.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS;
    this.phase = options.signal?.aborted ? "aborted" : "idle";
    this.onAbort = () => {
      if (this.phase === "finished" || this.phase === "failed" || this.phase === "aborted")
        return;
      this.closeCard();
      this.close("aborted");
    };
    if (this.phase !== "aborted")
      options.signal?.addEventListener("abort", this.onAbort, { once: true });
  }
  get cardId() {
    return this.cardInstanceId ?? undefined;
  }
  get active() {
    return this.phase === "active";
  }
  get started() {
    return this.cardInstanceId !== null;
  }
  async start(initialText) {
    if (this.phase !== "idle")
      return false;
    const body = initialText.trim();
    if (!body)
      return false;
    this.phase = "starting";
    try {
      const created = await this.options.api.createAiCard({
        credentials: this.options.credentials,
        robotCode: this.options.robotCode,
        target: this.options.target,
        text: body,
        ...this.options.cardTemplateId ? { cardTemplateId: this.options.cardTemplateId } : {},
        ...this.options.signal ? { signal: this.options.signal } : {}
      });
      this.cardInstanceId = created.cardInstanceId;
      if (this.phase !== "starting") {
        await this.closeCard();
        return false;
      }
      this.lastUpdateAt = this.now();
      this.phase = "active";
      return true;
    } catch (error) {
      if (this.options.signal?.aborted) {
        this.close("aborted");
        return false;
      }
      this.log.warn(`[钉钉] AI 卡片创建失败，回退为文本消息: ${String(error)}`);
      this.close("failed");
      return false;
    }
  }
  push(text) {
    if (this.phase !== "active")
      return;
    const body = text.trim();
    if (!body)
      return;
    this.pendingText = body;
    if (!this.scheduledUpdate && !this.updateWorker)
      this.launchUpdate();
  }
  async finish(finalText) {
    const body = finalText.trim();
    if (this.phase === "finished")
      return true;
    if (this.phase === "finishing")
      return this.finishPromise ?? false;
    if (this.phase !== "active" || !body)
      return false;
    this.phase = "finishing";
    this.pendingText = null;
    this.clearScheduled();
    const activeUpdate = this.updateWorker;
    this.finishPromise = (async () => {
      if (activeUpdate)
        await activeUpdate.catch(() => {
          return;
        });
      if (this.phase !== "finishing")
        return false;
      try {
        await this.options.api.finishAiCard({
          credentials: this.options.credentials,
          robotCode: this.options.robotCode,
          target: this.options.target,
          cardInstanceId: this.cardInstanceId ?? "",
          text: body,
          ...this.options.signal ? { signal: this.options.signal } : {}
        });
        if (this.phase !== "finishing")
          return false;
        this.close("finished");
        return true;
      } catch (error) {
        if (this.options.signal?.aborted) {
          this.close("aborted");
          return false;
        }
        this.log.error(`[钉钉] AI 卡片完成失败: ${String(error)}`);
        this.close("failed");
        return false;
      }
    })();
    return this.finishPromise;
  }
  async fail(text) {
    const body = text.trim();
    if (this.phase === "finished" || this.phase === "failed" || this.phase === "aborted")
      return false;
    if (!this.cardInstanceId || !body) {
      this.close("failed");
      return false;
    }
    this.phase = "finishing";
    this.pendingText = null;
    this.clearScheduled();
    const activeUpdate = this.updateWorker;
    if (activeUpdate)
      await activeUpdate.catch(() => {
        return;
      });
    try {
      await this.options.api.failAiCard({
        credentials: this.options.credentials,
        robotCode: this.options.robotCode,
        target: this.options.target,
        cardInstanceId: this.cardInstanceId,
        text: body,
        signal: AbortSignal.timeout(DEFAULT_FINALIZE_TIMEOUT_MS)
      });
      this.close("failed");
      return true;
    } catch {
      this.close("failed");
      return false;
    }
  }
  close(phase) {
    this.phase = phase;
    this.pendingText = null;
    this.clearScheduled();
    this.options.signal?.removeEventListener("abort", this.onAbort);
  }
  clearScheduled() {
    if (this.scheduledUpdate) {
      clearTimeout(this.scheduledUpdate);
      this.scheduledUpdate = null;
    }
  }
  async closeCard() {
    if (!this.cardInstanceId)
      return;
    await this.options.api.failAiCard({
      credentials: this.options.credentials,
      robotCode: this.options.robotCode,
      target: this.options.target,
      cardInstanceId: this.cardInstanceId,
      text: CARD_CLOSED_TEXT,
      signal: AbortSignal.timeout(DEFAULT_FINALIZE_TIMEOUT_MS)
    }).catch(() => {
      return;
    });
  }
  launchUpdate() {
    if (this.phase !== "active" || this.updateWorker || this.pendingText === null)
      return;
    const delayMs = Math.max(0, this.lastUpdateAt + this.updateIntervalMs - this.now());
    if (delayMs > 0) {
      this.scheduledUpdate = setTimeout(() => {
        this.scheduledUpdate = null;
        this.launchUpdate();
      }, delayMs);
      this.scheduledUpdate.unref?.();
      return;
    }
    const text = this.pendingText;
    this.pendingText = null;
    this.updateWorker = (async () => {
      try {
        await this.options.api.updateAiCard({
          credentials: this.options.credentials,
          robotCode: this.options.robotCode,
          target: this.options.target,
          cardInstanceId: this.cardInstanceId ?? "",
          text,
          ...this.options.signal ? { signal: this.options.signal } : {}
        });
        this.lastUpdateAt = this.now();
      } catch (error) {
        if (this.options.signal?.aborted || this.phase === "aborted")
          return;
        this.log.error(`[钉钉] AI 卡片更新失败: ${String(error)}`);
        this.close("failed");
      }
    })().finally(() => {
      this.updateWorker = null;
      if (this.phase === "active" && this.pendingText !== null)
        this.launchUpdate();
    });
  }
}

// service/dingtalk/media.ts
import path from "node:path";
var EXTENSION_BY_MIME = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "application/zip": ".zip"
};
var MIME_BY_EXTENSION = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".zip": "application/zip",
  ".mp3": "audio/mpeg",
  ".amr": "audio/amr",
  ".wav": "audio/wav",
  ".mp4": "video/mp4"
};
function safeAttachmentName(raw, fallbackExtension) {
  const base = typeof raw === "string" ? raw : "";
  const name = base.replace(/[\\/]+/g, "_").replace(/[\u0000-\u001f]/g, "").replace(/^\.+/, "").trim();
  if (!name)
    return `attachment${fallbackExtension}`;
  return name.length > 120 ? `${name.slice(0, 100)}${path.extname(name).slice(0, 20) || fallbackExtension}` : name;
}
async function downloadAttachment(api, credentials, attachment, options = { robotCode: credentials.robotCode }) {
  const { bytes, contentType } = await api.downloadAttachment({
    credentials,
    downloadCode: attachment.downloadCode,
    robotCode: options.robotCode,
    ...options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {},
    ...options.signal ? { signal: options.signal } : {}
  });
  const declared = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const guessedExtension = EXTENSION_BY_MIME[declared] ?? (attachment.kind === "image" ? ".jpg" : attachment.kind === "video" ? ".mp4" : attachment.kind === "audio" ? ".amr" : ".bin");
  const fileName = safeAttachmentName(attachment.fileName, guessedExtension);
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = MIME_BY_EXTENSION[extension] ?? (declared && declared !== "application/octet-stream" ? declared : "application/octet-stream");
  if (bytes.length === 0) {
    throw new DingTalkApiError("download-failed", "钉钉附件内容为空。");
  }
  return { bytes, fileName, mimeType, kind: attachment.kind };
}

// service/dingtalk/send.ts
var WEBHOOK_EXPIRY_SLACK_MS = 1e4;
function webhookUsable(target, now = Date.now()) {
  if (!target?.sessionWebhook)
    return false;
  if (typeof target.sessionWebhookExpiresAt !== "number")
    return true;
  return target.sessionWebhookExpiresAt - WEBHOOK_EXPIRY_SLACK_MS > now;
}
function proactiveTarget(ctx) {
  const target = ctx.target;
  if (!target)
    return;
  if (target.conversationType === "group") {
    const openConversationId = target.openConversationId ?? target.conversationId;
    return openConversationId ? { type: "group", openConversationId, robotCode: ctx.robotCode } : undefined;
  }
  return target.userId ? { type: "user", userId: target.userId, robotCode: ctx.robotCode } : undefined;
}
function splitText(text, limit) {
  return splitDingTalkText(text, limit);
}
async function sendTextMessage(text, ctx) {
  const body = typeof text === "string" ? text.trim() : "";
  if (!body)
    return;
  const target = ctx.target;
  if (webhookUsable(target)) {
    try {
      await ctx.api.sendSessionText({
        credentials: ctx.credentials,
        sessionWebhook: target.sessionWebhook,
        text: body,
        ...ctx.signal ? { signal: ctx.signal } : {}
      });
      return;
    } catch (error) {
      const proactive = proactiveTarget(ctx);
      if (!proactive)
        throw error;
      if (isAuthError(error) || isRateLimitError(error) || isTransientError(error))
        throw error;
    }
  }
  const proactive = proactiveTarget(ctx);
  if (!proactive) {
    throw new Error("钉钉回复目标缺失（webhook 已过期且没有可用的用户 id）");
  }
  await ctx.api.sendRobotText({
    credentials: ctx.credentials,
    target: proactive,
    text: body,
    ...ctx.markdown ? { markdown: true } : {},
    ...ctx.signal ? { signal: ctx.signal } : {}
  });
}
async function sendMediaMessage(kind, bytes, fileName, ctx) {
  const proactive = proactiveTarget(ctx);
  if (!proactive) {
    throw new Error("钉钉发送附件需要用户 id（会话 webhook 不支持附件）");
  }
  if (kind === "image") {
    await ctx.api.sendImage({
      credentials: ctx.credentials,
      target: proactive,
      fileName,
      bytes,
      ...ctx.signal ? { signal: ctx.signal } : {}
    });
    return;
  }
  await ctx.api.sendFile({
    credentials: ctx.credentials,
    target: proactive,
    fileName,
    bytes,
    ...ctx.signal ? { signal: ctx.signal } : {}
  });
}

// service/format.ts
var RESOURCE_MAX = 6;
function trim(value, max) {
  const body = (value ?? "").trim();
  if (body.length <= max)
    return body;
  return `${body.slice(0, max - 1)}…`;
}
function sessionLabel(sessionTitle) {
  return trim(sessionTitle, 40) || "当前会话";
}
function renderPermissionAsk(content) {
  const resources = content.resources.slice(0, RESOURCE_MAX).map((item) => `- \`${trim(item, 120)}\``);
  if (content.resources.length > RESOURCE_MAX) {
    resources.push(`- …另有 ${content.resources.length - RESOURCE_MAX} 项`);
  }
  return [
    `\uD83D\uDD10 **需要授权** · ${sessionLabel(content.sessionTitle)}`,
    "",
    `动作：\`${trim(content.action, 80)}\``,
    ...resources.length > 0 ? ["资源：", ...resources] : [],
    ...content.message ? ["", `说明：${trim(content.message, 300)}`] : [],
    "",
    "回复 **1** 允许一次，**2** 拒绝（也可以直接回复拒绝理由）。"
  ].join(`
`);
}
function renderField(field, index) {
  const required = field.required ? "（必填）" : "";
  const description = field.description ? ` — ${trim(field.description, 120)}` : "";
  if (field.options && field.options.length > 0) {
    const options = field.options.map((option, optionIndex) => `${optionIndex + 1}.${trim(option.label, 40)}`).join(" / ");
    return `${index + 1}. **${trim(field.title, 60)}**${required}：${options}${description}`;
  }
  if (field.type === "boolean") {
    return `${index + 1}. **${trim(field.title, 60)}**${required}：是 / 否${description}`;
  }
  if (field.type === "number" || field.type === "integer") {
    return `${index + 1}. **${trim(field.title, 60)}**${required}：数字${description}`;
  }
  if (field.type === "external") {
    return `${index + 1}. **${trim(field.title, 60)}**：需要你在 OpenChamber 里打开链接完成${description}`;
  }
  return `${index + 1}. **${trim(field.title, 60)}**${required}：文本${description}`;
}
function renderQuestionAsk(content) {
  const header = `❓ **${trim(content.ask.title, 80) || "需要你回答"}** · ${sessionLabel(content.sessionTitle)}`;
  if (content.ask.kind === "page") {
    return [header, "", "这个问题要在 OpenChamber 窗口里回答；直接回复文字会作为新消息发给 agent。"].join(`
`);
  }
  const fields = content.ask.fields;
  const multiple = fields.length > 1;
  return [
    header,
    "",
    ...fields.map(renderField),
    "",
    multiple ? "回复格式：每行一项 `1=选项` 或 `字段名=值`。" : "回复序号或内容即可。"
  ].join(`
`);
}
var ALLOW_WORDS = new Set(["1", "y", "yes", "ok", "allow", "允许", "同意", "批准", "好的", "可以"]);
var DENY_WORDS = new Set(["2", "n", "no", "deny", "reject", "拒绝", "不允许", "不行"]);
function parsePermissionAnswer(text) {
  const body = text.trim().toLowerCase();
  if (!body)
    return null;
  if (ALLOW_WORDS.has(body))
    return { decision: "allow" };
  if (DENY_WORDS.has(body))
    return { decision: "deny", message: "已在钉钉中拒绝" };
  const prefixed = /^(?:拒绝|deny|reject)[:：\s]+(.+)$/s.exec(body);
  if (prefixed?.[1])
    return { decision: "deny", message: prefixed[1].slice(0, 2000) };
  return null;
}
function matchOption(field, raw) {
  const value = raw.trim();
  if (!value)
    return null;
  const options = field.options ?? [];
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= options.length) {
    return options[numeric - 1]?.value ?? null;
  }
  const byLabel = options.find((option) => option.label.trim().toLowerCase() === value.toLowerCase());
  if (byLabel)
    return byLabel.value;
  const byValue = options.find((option) => option.value.toLowerCase() === value.toLowerCase());
  return byValue ? byValue.value : null;
}
function parseBool(raw) {
  const value = raw.trim().toLowerCase();
  if (["是", "对", "y", "yes", "true", "1", "同意", "允许"].includes(value))
    return true;
  if (["否", "不", "n", "no", "false", "0", "拒绝"].includes(value))
    return false;
  return null;
}
function parseField(field, raw) {
  const body = raw.trim();
  if (!body)
    return { error: `「${field.title}」不能为空` };
  if (field.type === "boolean") {
    const parsed = parseBool(body);
    return parsed === null ? { error: `「${field.title}」请回答 是 / 否` } : { value: parsed };
  }
  if (field.type === "number" || field.type === "integer") {
    const numeric = Number(body);
    if (!Number.isFinite(numeric))
      return { error: `「${field.title}」需要一个数字` };
    return { value: field.type === "integer" ? Math.round(numeric) : numeric };
  }
  if (field.options && field.options.length > 0) {
    if (field.type === "multiselect") {
      const parts = body.split(/[,，、\s]+/).filter(Boolean);
      const values = [];
      for (const part of parts) {
        const matched = matchOption(field, part);
        if (!matched) {
          if (field.custom)
            values.push(part);
          else
            return { error: `「${field.title}」没有选项“${trim(part, 30)}”` };
        } else {
          values.push(matched);
        }
      }
      if (values.length === 0)
        return { error: `「${field.title}」至少选一项` };
      return { value: values };
    }
    const matched = matchOption(field, body);
    if (!matched) {
      if (field.custom)
        return { value: body };
      const hint = field.options.map((option, index) => `${index + 1}.${option.label}`).join(" / ");
      return { error: `「${field.title}」请回复序号或选项：${hint}` };
    }
    return { value: matched };
  }
  return { value: body };
}
function whenHolds(field, values) {
  if (!field.when || field.when.length === 0)
    return true;
  return field.when.every((clause) => {
    const current = values[clause.key];
    return clause.op === "eq" ? current === clause.value : current !== clause.value;
  });
}
function parseFormAnswer(fields, text) {
  const answerable = fields.filter((field) => field.type !== "external");
  if (answerable.length === 0) {
    return { ok: false, error: "这个问题需要在 OpenChamber 里回答。" };
  }
  const body = text.trim();
  if (!body)
    return { ok: false, error: "回复内容为空。" };
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const inline = new Map;
  for (const line of lines) {
    const match = /^([^=＝]+)[=＝](.*)$/s.exec(line);
    if (!match)
      continue;
    const key = match[1]?.trim().toLowerCase() ?? "";
    inline.set(key, match[2] ?? "");
  }
  if (answerable.length === 1) {
    const field = answerable[0];
    const single = field.key.toLowerCase();
    const titled = field.title.trim().toLowerCase();
    const raw = inline.get(single) ?? inline.get(titled) ?? body;
    const parsed = parseField(field, raw);
    return "error" in parsed ? { ok: false, error: parsed.error } : { ok: true, values: { [field.key]: parsed.value } };
  }
  if (inline.size === 0) {
    return {
      ok: false,
      error: `有 ${answerable.length} 个字段，请按「字段=值」每行一行回复，例如：${answerable[0].title}=值`
    };
  }
  const values = {};
  for (const field of answerable) {
    if (!whenHolds(field, values))
      continue;
    const key = field.key.toLowerCase();
    const titled = field.title.trim().toLowerCase();
    const raw = inline.get(key) ?? inline.get(titled);
    if (raw === undefined) {
      if (field.required)
        return { ok: false, error: `缺少必填字段「${field.title}」` };
      continue;
    }
    const parsed = parseField(field, raw);
    if ("error" in parsed)
      return { ok: false, error: parsed.error };
    values[field.key] = parsed.value;
  }
  if (Object.keys(values).length === 0)
    return { ok: false, error: "没有识别到任何字段，请用「字段=值」格式。" };
  return { ok: true, values };
}

// service/bridge.ts
var ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
var REFUSAL_COOLDOWN_MS = 5 * 60000;
var CARD_PLACEHOLDER = "⏳ 正在处理…";
var TEXT_CHUNK_CHARS = 3500;
var CARD_MAX_CHARS = 6000;

class Bridge {
  store;
  host;
  dataDir;
  log;
  onStateChange;
  api;
  pendings = [];
  cards = new Map;
  refusals = new Map;
  lastInbound = null;
  tail = Promise.resolve();
  epochs = new Map;
  constructor(deps) {
    this.store = deps.store;
    this.host = deps.host;
    this.dataDir = deps.dataDir;
    this.log = deps.log;
    this.onStateChange = deps.onStateChange;
    this.api = deps.api ?? createDingTalkApi({ logger: console });
  }
  whenIdle() {
    return this.tail;
  }
  snapshot() {
    const binding = this.store.binding;
    return {
      configured: this.configured,
      ownerUserId: this.store.value.ownerUserId,
      binding: binding ? {
        userId: binding.userId,
        sessionId: binding.sessionId,
        title: binding.title,
        directory: binding.directory,
        since: binding.boundAt
      } : null,
      pending: this.pendings.map((item) => ({
        kind: item.kind,
        sessionId: item.sessionId,
        at: item.at,
        title: item.kind === "form" ? item.fields[0]?.title ?? "提问" : "授权请求"
      })),
      sessions: this.store.value.sessions.length,
      activity: this.store.value.activity.slice(-12).reverse()
    };
  }
  get configured() {
    const settings = this.store.settings;
    return !!settings.clientId && !!settings.clientSecret;
  }
  get robotCode() {
    const settings = this.store.settings;
    return settings.robotCode || settings.clientId;
  }
  get credentials() {
    return { clientId: this.store.settings.clientId, clientSecret: this.store.settings.clientSecret };
  }
  fallbackTarget() {
    const binding = this.store.binding;
    if (binding)
      return binding.target;
    const owner = this.store.value.ownerUserId;
    if (!owner)
      return null;
    return { conversationType: "single", conversationId: "", userId: owner };
  }
  send(target, text) {
    if (!target)
      return Promise.reject(new Error("没有可用的钉钉回复目标"));
    const ctx = {
      api: this.api,
      credentials: this.credentials,
      robotCode: this.robotCode,
      target,
      markdown: true
    };
    return sendTextMessage(text, ctx);
  }
  async reply(target, text) {
    try {
      await this.sendChecked(target, text);
    } catch (error) {
      await this.store.logActivity("error", `回复失败：${errorText(error)}`);
      this.log(`回复钉钉失败：${errorText(error)}`);
    }
  }
  async sendChecked(target, text) {
    for (const chunk of this.chunks(text)) {
      await this.send(target, chunk);
    }
    await this.store.logActivity("out", text);
  }
  async sendOutboxJob(job) {
    const target = this.fallbackTarget();
    if (!target)
      throw new Error("钉钉里还没有绑定用户");
    const text = job.text?.trim() ?? "";
    if (text)
      await this.sendChecked(target, text);
    for (const file of job.files ?? []) {
      await this.sendFileTo(target, file);
    }
  }
  async sendFileTo(target, file) {
    const resolved = path2.resolve(file);
    let bytes;
    try {
      const info = await stat(resolved);
      if (!info.isFile())
        throw new Error("不是一个文件");
      if (info.size > ATTACHMENT_MAX_BYTES)
        throw new Error(`文件超过 ${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB`);
      bytes = await readFile(resolved);
    } catch (error) {
      throw new Error(`读不到附件 ${file}：${errorText(error)}`);
    }
    const name = path2.basename(resolved);
    const kind = /\.(png|jpe?g|gif|webp|bmp)$/i.test(name) ? "image" : "file";
    await sendMediaMessage(kind, bytes, name, {
      api: this.api,
      credentials: this.credentials,
      robotCode: this.robotCode,
      target
    });
    await this.store.logActivity("out", `附件 ${name}`);
  }
  async shutdown() {
    await this.closeCards("服务已停止，这一轮的结果请在 OpenChamber 里查看。");
  }
  chunks(text) {
    const body = text.trim();
    if (body.length <= TEXT_CHUNK_CHARS)
      return body ? [body] : [];
    return splitText(body, TEXT_CHUNK_CHARS);
  }
  handleInbound(callback) {
    const message = normalizeRobotCallback(callback);
    if (!message) {
      this.log("忽略了一条无法识别的钉钉消息");
      return;
    }
    this.enqueue(() => this.processInbound(message));
  }
  enqueue(task) {
    this.tail = this.tail.then(task, task).catch((error) => {
      this.log(`处理失败：${errorText(error)}`);
    });
  }
  async processInbound(message) {
    const settings = this.store.settings;
    this.lastInbound = { target: message.target, at: Date.now() };
    if (!this.allowed(message.senderId)) {
      await this.refuse(message);
      return;
    }
    if (!settings.allowedUsers.length && !this.store.value.ownerUserId) {
      await this.store.setOwner(message.senderId);
      await this.store.logActivity("state", `已绑定第一位用户 ${message.senderId}`);
      this.onStateChange();
    }
    const binding = this.store.binding;
    if (binding && binding.userId === message.senderId) {
      await this.store.refreshTarget(message.target);
      this.onStateChange();
    }
    const text = message.text?.trim() ?? "";
    await this.store.logActivity("in", text ? `${message.senderNick ?? message.senderId}: ${text}` : `${message.senderNick ?? message.senderId} 发来附件`);
    this.react(REACTION_THINKING_NAME, message.target.messageId);
    if (text.startsWith("/")) {
      const handled = await this.handleCommand(message, text);
      if (handled)
        return;
    }
    if (text && this.pendings.length > 0) {
      const answered = await this.answerPending(message, text);
      if (answered)
        return;
    }
    const prompt = await this.buildPrompt(message);
    if (!prompt) {
      await this.reply(message.target, "这条消息里没有可以转给 agent 的内容。");
      return;
    }
    await this.deliver(message, prompt);
  }
  allowed(senderId) {
    const settings = this.store.settings;
    const owner = this.store.value.ownerUserId;
    if (settings.allowedUsers.length > 0)
      return settings.allowedUsers.includes(senderId);
    if (!owner)
      return true;
    return owner === senderId;
  }
  async refuse(message) {
    const until = this.refusals.get(message.senderId) ?? 0;
    if (until > Date.now())
      return;
    this.refusals.set(message.senderId, Date.now() + REFUSAL_COOLDOWN_MS);
    await this.reply(message.target, "这个机器人已经绑定了另一位用户，暂时不能响应你。需要换人请先在 OpenChamber 的「钉钉桥接」面板里解除绑定。");
  }
  async buildPrompt(message) {
    const lines = [];
    const text = message.text?.trim() ?? "";
    if (text)
      lines.push(text);
    if (message.attachment) {
      try {
        const downloaded = await downloadAttachment(this.api, { ...this.credentials, robotCode: this.robotCode, cardTemplateId: "" }, message.attachment, {
          robotCode: this.robotCode,
          maxBytes: ATTACHMENT_MAX_BYTES
        });
        const dir = path2.join(this.dataDir, "uploads");
        await mkdir(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const target = path2.join(dir, `${stamp}-${downloaded.fileName}`);
        await writeFile(target, downloaded.bytes, { mode: 384 });
        lines.push(lines.length > 0 ? "" : "钉钉发来一个附件，已保存到本机：", `附件路径：${target}`, "需要时请直接读取这个文件。");
        await this.store.logActivity("state", `附件已保存：${downloaded.fileName}`);
      } catch (error) {
        lines.push(`（有一个钉钉附件没能下载：${errorText(error)}）`);
      }
    }
    return lines.join(`
`).trim();
  }
  async deliver(message, prompt) {
    const binding = this.store.binding;
    if (binding && binding.sessionId) {
      try {
        await this.host.sessions.send(binding.sessionId, prompt);
        return;
      } catch (error) {
        const gone = /404|not.?found/i.test(errorText(error));
        await this.store.logActivity("error", `发送到会话失败：${errorText(error)}`);
        if (!gone) {
          await this.reply(binding.target, `没能把消息送到 OpenChamber：${errorText(error)}
回复 /new 可以开一个新会话。`);
          return;
        }
        await this.store.setBinding(null);
        this.onStateChange();
      }
    }
    await this.startSession(message, prompt);
  }
  async startSession(message, prompt) {
    const directory = this.store.settings.directory;
    if (!directory) {
      await this.reply(message.target, "还差一步：在 OpenChamber 的「钉钉桥接」面板里选择默认项目目录，下一条消息就会开一个新会话。");
      return;
    }
    const title = this.store.value.pendingTitle?.trim() || `钉钉 · ${message.senderNick ?? message.senderId}`;
    try {
      const started = await this.host.sessions.start({ prompt, directory, title });
      const binding = {
        userId: message.senderId,
        sessionId: started.sessionId,
        directory: started.directory ?? directory,
        title,
        target: message.target,
        boundAt: Date.now()
      };
      await this.store.setBinding(binding);
      if (this.store.value.pendingTitle)
        await this.store.setPendingTitle(null);
      await this.store.rememberSession({
        sessionId: binding.sessionId,
        title,
        directory: binding.directory,
        at: binding.boundAt
      });
      await this.store.logActivity("state", `已新建会话 ${started.sessionId}`);
      this.onStateChange();
    } catch (error) {
      await this.store.logActivity("error", `新建会话失败：${errorText(error)}`);
      await this.reply(message.target, `没能新建会话：${errorText(error)}
请确认面板里的项目目录还在。`);
    }
  }
  async handleEvent(request) {
    const { event, content } = request;
    const binding = this.store.binding;
    const isBound = !!binding && binding.sessionId === event.session.id;
    const isSubagent = !!event.session.parentId;
    if (isSubagent)
      return;
    switch (event.type) {
      case "turn-started": {
        if (!isBound)
          return;
        const epoch = this.bumpEpoch(event.session.id);
        await this.react(REACTION_THINKING_NAME, binding?.target.messageId);
        this.startCard(event.session.id, binding.target, epoch);
        return;
      }
      case "turn-finished": {
        const reply = content?.type === "turn-finished" ? content.reply : "";
        const truncated = content?.type === "turn-finished" ? content.replyTruncated : false;
        const title = content?.type === "turn-finished" ? content.sessionTitle : null;
        if (isBound) {
          await this.finishTurn(event.session.id, reply, truncated, binding.target);
          await this.react(REACTION_DONE_NAME, binding?.target.messageId);
          return;
        }
        if (this.store.settings.notifyOtherSessions) {
          await this.notifyOther(title, reply, event.project.directory);
        }
        return;
      }
      case "turn-failed": {
        const error = content?.type === "turn-failed" ? content.error : null;
        const detail = error ? `${error.type}: ${error.message}` : "未知错误";
        if (isBound) {
          await this.failTurn(event.session.id, `❌ 这一轮失败了：${detail}`, binding.target);
          await this.react(REACTION_DONE_NAME, binding?.target.messageId);
          return;
        }
        if (this.store.settings.notifyOtherSessions) {
          await this.notifyOther(content?.type === "turn-failed" ? content.sessionTitle : null, `❌ 失败：${detail}`, event.project.directory);
        }
        return;
      }
      case "permission-asked": {
        if (!isBound || !event.permission)
          return;
        this.pendings.push({
          kind: "permission",
          at: Date.now(),
          sessionId: event.session.id,
          requestId: event.permission.requestId
        });
        this.trimPendings();
        if (content?.type === "permission-asked") {
          await this.reply(binding.target, renderPermissionAsk(content));
        } else {
          await this.reply(binding.target, `\uD83D\uDD10 agent 需要授权（${event.permission.requestId}）：回复 1 允许，2 拒绝。`);
        }
        this.onStateChange();
        return;
      }
      case "question-asked": {
        if (!isBound || !event.question)
          return;
        if (content?.type === "question-asked" && content.ask.kind === "form") {
          this.pendings.push({
            kind: "form",
            at: Date.now(),
            sessionId: event.session.id,
            formId: content.ask.id,
            fields: content.ask.fields
          });
          this.trimPendings();
          await this.reply(binding.target, renderQuestionAsk(content));
        } else if (content?.type === "question-asked") {
          await this.reply(binding.target, renderQuestionAsk(content));
        }
        this.onStateChange();
        return;
      }
      default:
        return;
    }
  }
  trimPendings() {
    while (this.pendings.length > 5)
      this.pendings.shift();
  }
  async closeCards(note) {
    const cards = [...this.cards.values()];
    this.cards.clear();
    for (const card of cards) {
      await card.stream.fail(note).catch(() => {
        return;
      });
    }
  }
  async startCard(sessionId, target, epoch) {
    const existing = this.cards.get(sessionId);
    if (existing) {
      await existing.stream.fail("新的回合已开始，这张卡片结束了。").catch(() => {
        return;
      });
      this.cards.delete(sessionId);
    }
    const stream = new DingTalkCardStream({
      api: this.api,
      credentials: this.credentials,
      robotCode: this.robotCode,
      target: cardTarget(target),
      ...this.store.settings.cardTemplateId ? { cardTemplateId: this.store.settings.cardTemplateId } : {},
      logger: console
    });
    const started = await stream.start(CARD_PLACEHOLDER);
    if (!started)
      return;
    if (this.epochs.get(sessionId) !== epoch) {
      await stream.fail("这一轮已经结束，卡片不再更新。").catch(() => {
        return;
      });
      return;
    }
    this.cards.set(sessionId, { stream, target, startedAt: Date.now() });
  }
  bumpEpoch(sessionId) {
    const next = (this.epochs.get(sessionId) ?? 0) + 1;
    this.epochs.set(sessionId, next);
    return next;
  }
  async finishTurn(sessionId, reply, truncated, target) {
    this.bumpEpoch(sessionId);
    const body = reply.trim() || "（这一轮没有文字回复）";
    const text = truncated ? `${body}

_（回复过长，已截断）_` : body;
    const card = this.cards.get(sessionId);
    this.cards.delete(sessionId);
    if (card && text.length > CARD_MAX_CHARS) {
      await card.stream.fail("这一轮的回复较长，已拆成下面的消息。").catch(() => {
        return;
      });
      await this.reply(target, text);
      return;
    }
    if (card && await card.stream.finish(text)) {
      await this.store.logActivity("out", `卡片回复：${text.slice(0, 80)}`);
      return;
    }
    await this.reply(target, text);
  }
  async failTurn(sessionId, text, target) {
    this.bumpEpoch(sessionId);
    const card = this.cards.get(sessionId);
    this.cards.delete(sessionId);
    if (card && await card.stream.fail(text)) {
      await this.store.logActivity("out", text);
      return;
    }
    await this.reply(target, text);
  }
  async notifyOther(title, reply, directory) {
    const body = reply.trim();
    if (!body)
      return;
    const target = this.fallbackTarget();
    if (!target)
      return;
    const name = title?.trim() || directory?.split(/[\\/]/).filter(Boolean).pop() || "另一个会话";
    await this.reply(target, `\uD83D\uDCE3 **${name}**

${body}`);
  }
  async react(name, messageId) {
    const conversationId = this.store.binding?.target.conversationId ?? this.lastInbound?.target.conversationId;
    if (!messageId || !conversationId)
      return;
    if (!this.configured)
      return;
    try {
      if (name === REACTION_THINKING_NAME) {
        await this.api.recallReaction({
          credentials: this.credentials,
          robotCode: this.robotCode,
          messageId,
          conversationId,
          reactionName: REACTION_DONE_NAME
        }).catch(() => {
          return;
        });
      }
      await this.api.addReaction({
        credentials: this.credentials,
        robotCode: this.robotCode,
        messageId,
        conversationId,
        reactionName: name
      });
    } catch {}
  }
  async answerPending(message, text) {
    const pending = this.pendings[0];
    if (!pending)
      return false;
    if (pending.kind === "permission") {
      const answer = parsePermissionAnswer(text);
      if (!answer)
        return false;
      try {
        await this.host.sessions.answerPermission(pending.sessionId, pending.requestId, answer);
        this.pendings.shift();
        await this.reply(message.target, answer.decision === "allow" ? "✅ 已允许。" : "⛔ 已拒绝。");
        await this.react(REACTION_DONE_NAME, message.target.messageId);
      } catch (error) {
        this.pendings.shift();
        await this.reply(message.target, `这个授权请求已经不需要回答了（${errorText(error)}）。`);
      }
      this.onStateChange();
      return true;
    }
    const parsed = parseFormAnswer(pending.fields, text);
    if (!parsed.ok) {
      await this.reply(message.target, `还没识别你的回答：${parsed.error}`);
      return true;
    }
    try {
      await this.host.sessions.answerForm(pending.sessionId, pending.formId, parsed.values);
      this.pendings.shift();
      await this.reply(message.target, "✅ 已提交回答。");
      await this.react(REACTION_DONE_NAME, message.target.messageId);
    } catch (error) {
      this.pendings.shift();
      await this.reply(message.target, `这个问题已经在别处回答过了（${errorText(error)}）。`);
    }
    this.onStateChange();
    return true;
  }
  async handleCommand(message, raw) {
    const [head] = raw.trim().split(/\s+/, 1);
    const name = (head ?? "").toLowerCase();
    const argument = raw.trim().slice(head?.length ?? 0).trim();
    const target = message.target;
    switch (name) {
      case "/help":
      case "/h":
      case "/?": {
        await this.reply(target, HELP_TEXT);
        return true;
      }
      case "/status": {
        await this.reply(target, await this.statusText());
        return true;
      }
      case "/ping": {
        await this.reply(target, "\uD83C\uDFD3 连接正常。");
        return true;
      }
      case "/id": {
        await this.reply(target, `你的 staffId：\`${message.senderId}\`
会话：\`${this.store.binding?.sessionId ?? "（未绑定）"}\``);
        return true;
      }
      case "/new": {
        const previous = this.store.binding;
        await this.closeCards("已切换到新会话，这张卡片结束了。");
        await this.store.setBinding(null);
        await this.store.setPendingTitle(argument || null);
        this.pendings.length = 0;
        this.onStateChange();
        await this.reply(target, `${previous ? "已解除当前会话，" : ""}下一条消息会新建一个会话${argument ? `（标题：${argument}）` : ""}。`);
        return true;
      }
      case "/sessions": {
        const list = this.store.value.sessions;
        if (list.length === 0) {
          await this.reply(target, "还没有通过钉钉建过会话。");
          return true;
        }
        const current = this.store.binding?.sessionId;
        const lines = list.slice(0, 10).map((entry, index) => {
          const mark = entry.sessionId === current ? " ✅" : "";
          const title = entry.title || entry.directory || entry.sessionId;
          return `${index + 1}. ${title}${mark}
   \`${entry.sessionId}\``;
        });
        await this.reply(target, ["最近由钉钉创建的会话：", "", ...lines, "", "/switch 序号 可切回去。"].join(`
`));
        return true;
      }
      case "/switch":
      case "/s": {
        const list = this.store.value.sessions;
        if (!argument) {
          await this.reply(target, "用法：/switch 序号（用 /sessions 看列表）");
          return true;
        }
        const index = Number(argument);
        const entry = Number.isInteger(index) && index >= 1 && index <= list.length ? list[index - 1] : list.find((item) => item.sessionId === argument);
        if (!entry) {
          await this.reply(target, `没有找到「${argument}」，用 /sessions 看看有哪些。`);
          return true;
        }
        await this.store.setBinding({
          userId: message.senderId,
          sessionId: entry.sessionId,
          directory: entry.directory,
          title: entry.title,
          target,
          boundAt: Date.now()
        });
        await this.store.logActivity("state", `切换会话 ${entry.sessionId}`);
        this.onStateChange();
        await this.reply(target, `已切到「${entry.title || entry.sessionId}」。`);
        return true;
      }
      case "/stop": {
        const binding = this.store.binding;
        if (!binding) {
          await this.reply(target, "当前没有绑定的会话。");
          return true;
        }
        try {
          const result = await this.host.sessions.stop(binding.sessionId);
          this.bumpEpoch(binding.sessionId);
          await this.closeCards("⏹ 这一轮被停止了。");
          await this.reply(target, result.stopped ? "⏹ 已请求停止这一轮。" : "这一轮已经结束了。");
        } catch (error) {
          await this.reply(target, `停止失败：${errorText(error)}`);
        }
        return true;
      }
      case "/unbind": {
        await this.closeCards("已解除绑定，这张卡片结束了。");
        await this.store.setBinding(null);
        await this.store.setPendingTitle(null);
        this.pendings.length = 0;
        this.onStateChange();
        await this.reply(target, "已解除绑定，下一条消息会开新会话。");
        return true;
      }
      case "/dir": {
        if (!argument) {
          await this.reply(target, `默认项目目录：\`${this.store.settings.directory || "（未设置）"}\``);
          return true;
        }
        await this.store.patchSettings({ directory: argument });
        this.onStateChange();
        await this.reply(target, `已把默认项目目录设为 \`${argument}\`，下一条新会话就用它。`);
        return true;
      }
      case "/notify": {
        const on = argument.toLowerCase();
        if (on !== "on" && on !== "off") {
          await this.reply(target, `其它会话的提醒现在是：${this.store.settings.notifyOtherSessions ? "开" : "关"}。用法 /notify on|off`);
          return true;
        }
        await this.store.patchSettings({ notifyOtherSessions: on === "on" });
        this.onStateChange();
        await this.reply(target, `其它会话结束时推送到钉钉：${on === "on" ? "已打开" : "已关闭"}。`);
        return true;
      }
      case "/pending":
      case "/rq": {
        const pending = this.pendings[0];
        if (!pending) {
          await this.reply(target, "当前没有等待你回答的请求。");
          return true;
        }
        await this.reply(target, pending.kind === "permission" ? "还有一条授权请求在等你：回复 1 允许，2 拒绝。" : "还有一个提问在等你：按提示回复内容即可。");
        return true;
      }
      default:
        return false;
    }
  }
  async statusText() {
    const settings = this.store.settings;
    const binding = this.store.binding;
    const lines = [
      "\uD83D\uDCCB **钉钉桥接状态**",
      "",
      `凭据：${this.configured ? "已配置" : "未配置"}`,
      `默认目录：\`${settings.directory || "未设置"}\``,
      `其它会话提醒：${settings.notifyOtherSessions ? "开" : "关"}`
    ];
    if (binding) {
      lines.push(`当前会话：${binding.title || binding.sessionId}`, `\`${binding.sessionId}\``);
      try {
        const status = await this.host.sessions.status(binding.sessionId);
        lines.push(`运行状态：${status.status === "busy" ? "正在处理" : status.status === "waiting" ? "等待你回答" : "空闲"}`);
      } catch {
        lines.push("运行状态：会话已不可用，发一条消息会重建");
      }
    } else {
      lines.push("当前会话：未绑定（下一条消息会新建）");
    }
    if (this.pendings.length > 0) {
      lines.push(`等你回答：${this.pendings.length} 个请求`);
    }
    return lines.join(`
`);
  }
}
var HELP_TEXT = [
  "\uD83E\uDD16 **钉钉 ⇄ OpenChamber**",
  "",
  "直接发消息就是给 agent 的新指令；图片和文件会存到本机并把路径一起交给 agent。",
  "",
  "**会话**",
  "`/new [标题]` 下一条消息开新会话",
  "`/sessions` 最近由钉钉建过的会话",
  "`/switch 序号` 切回旧会话",
  "`/unbind` 解除绑定",
  "`/stop` 中断当前这一轮",
  "",
  "**运行**",
  "`/status` 绑定、目录、当前状态",
  "`/notify on|off` 其它会话结束时也推到钉钉",
  "`/dir [路径]` 查看或设置默认项目目录",
  "`/pending` 查看等待回答的授权或提问",
  "`/ping` 连通性检查",
  "`/help` 这份说明",
  "",
  "授权请求回复 **1** 允许、**2** 拒绝；提问按提示回复序号或「字段=值」。"
].join(`
`);
function cardTarget(target) {
  if (target.conversationType === "group") {
    return { type: "group", openConversationId: target.openConversationId ?? target.conversationId };
  }
  return { type: "user", ...target.userId ? { userId: target.userId } : {} };
}
function errorText(error) {
  if (error instanceof Error)
    return error.message;
  const value = error?.message;
  return typeof value === "string" ? value : String(error);
}

// service/config.ts
import { mkdir as mkdir2, readFile as readFile2, rename, writeFile as writeFile2 } from "node:fs/promises";
import os from "node:os";
import path3 from "node:path";
var ACTIVITY_MAX = 30;
var SESSIONS_MAX = 30;
function resolveDataDir(env = process.env) {
  const given = (env.OPENCHAMBER_SERVICE_DATA_DIR ?? "").trim();
  if (given)
    return given;
  return path3.join(os.homedir(), ".openchamber-dingtalk");
}
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function stringList(value) {
  if (!Array.isArray(value))
    return [];
  return [...new Set(value.map((item) => text(item)).filter(Boolean))];
}
function normalizeStore(value) {
  const raw = value && typeof value === "object" ? value : {};
  const settingsRaw = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
  const settings = {
    clientId: text(settingsRaw.clientId),
    clientSecret: text(settingsRaw.clientSecret),
    robotCode: text(settingsRaw.robotCode),
    cardTemplateId: text(settingsRaw.cardTemplateId),
    directory: text(settingsRaw.directory),
    allowedUsers: stringList(settingsRaw.allowedUsers),
    enabled: bool(settingsRaw.enabled, true),
    notifyOtherSessions: bool(settingsRaw.notifyOtherSessions, false)
  };
  const bindingRaw = raw.binding && typeof raw.binding === "object" ? raw.binding : null;
  const bindingTarget = bindingRaw?.target && typeof bindingRaw.target === "object" ? bindingRaw.target : null;
  const binding = bindingRaw && bindingTarget && text(bindingRaw.sessionId) && text(bindingRaw.userId) ? {
    userId: text(bindingRaw.userId),
    sessionId: text(bindingRaw.sessionId),
    directory: text(bindingRaw.directory),
    title: text(bindingRaw.title),
    boundAt: Number.isFinite(bindingRaw.boundAt) ? Number(bindingRaw.boundAt) : Date.now(),
    target: {
      conversationType: bindingTarget.conversationType === "group" ? "group" : "single",
      conversationId: text(bindingTarget.conversationId),
      ...text(bindingTarget.messageId) ? { messageId: text(bindingTarget.messageId) } : {},
      ...text(bindingTarget.userId) ? { userId: text(bindingTarget.userId) } : {},
      ...text(bindingTarget.openConversationId) ? { openConversationId: text(bindingTarget.openConversationId) } : {},
      ...text(bindingTarget.sessionWebhook) ? { sessionWebhook: text(bindingTarget.sessionWebhook) } : {},
      ...Number.isFinite(bindingTarget.sessionWebhookExpiresAt) ? { sessionWebhookExpiresAt: Number(bindingTarget.sessionWebhookExpiresAt) } : {}
    }
  } : null;
  const sessions = Array.isArray(raw.sessions) ? raw.sessions.map((item) => item && typeof item === "object" ? item : null).filter((item) => item !== null && !!text(item.sessionId)).map((item) => ({
    sessionId: text(item.sessionId),
    title: text(item.title),
    directory: text(item.directory),
    at: Number.isFinite(item.at) ? Number(item.at) : 0
  })).slice(0, SESSIONS_MAX) : [];
  const activity = Array.isArray(raw.activity) ? raw.activity.map((item) => item && typeof item === "object" ? item : null).filter((item) => item !== null && !!text(item.text)).map((item) => ({
    at: Number.isFinite(item.at) ? Number(item.at) : 0,
    kind: item.kind === "in" || item.kind === "out" || item.kind === "error" ? item.kind : "state",
    text: text(item.text).slice(0, 200)
  })).slice(-ACTIVITY_MAX) : [];
  return {
    settings,
    binding,
    ownerUserId: text(raw.ownerUserId) || null,
    pendingTitle: text(raw.pendingTitle) || null,
    sessions,
    activity
  };
}

class ConfigStore {
  file;
  state;
  constructor(file, state) {
    this.file = file;
    this.state = state;
  }
  static async open(dataDir) {
    const dir = dataDir || resolveDataDir();
    await mkdir2(dir, { recursive: true });
    const file = path3.join(dir, "bridge.json");
    let state;
    try {
      state = normalizeStore(JSON.parse(await readFile2(file, "utf8")));
    } catch (error) {
      const code = error.code;
      if (code !== "ENOENT") {
        await rename(file, `${file}.broken-${Date.now()}`).catch(() => {
          return;
        });
        console.warn(`[钉钉] 配置文件无法读取，已备份并从默认值开始: ${String(error)}`);
      }
      state = normalizeStore({});
    }
    return new ConfigStore(file, state);
  }
  get value() {
    return this.state;
  }
  get settings() {
    return this.state.settings;
  }
  get binding() {
    return this.state.binding;
  }
  async patchSettings(patch) {
    const next = {
      ...this.state.settings,
      ...patch.clientId !== undefined ? { clientId: text(patch.clientId) } : {},
      ...patch.clientSecret !== undefined ? { clientSecret: text(patch.clientSecret) } : {},
      ...patch.robotCode !== undefined ? { robotCode: text(patch.robotCode) } : {},
      ...patch.cardTemplateId !== undefined ? { cardTemplateId: text(patch.cardTemplateId) } : {},
      ...patch.directory !== undefined ? { directory: text(patch.directory) } : {},
      ...patch.allowedUsers !== undefined ? { allowedUsers: stringList(patch.allowedUsers) } : {},
      ...patch.enabled !== undefined ? { enabled: patch.enabled } : {},
      ...patch.notifyOtherSessions !== undefined ? { notifyOtherSessions: patch.notifyOtherSessions } : {}
    };
    this.state = { ...this.state, settings: next };
    await this.flush();
    return next;
  }
  async setBinding(binding) {
    this.state = { ...this.state, binding };
    await this.flush();
  }
  async setOwner(userId) {
    this.state = { ...this.state, ownerUserId: userId };
    await this.flush();
  }
  async setPendingTitle(title) {
    this.state = { ...this.state, pendingTitle: title ? text(title) : null };
    await this.flush();
  }
  async refreshTarget(target) {
    const binding = this.state.binding;
    if (!binding)
      return;
    this.state = { ...this.state, binding: { ...binding, target } };
    await this.flush();
  }
  async rememberSession(entry) {
    const rest = this.state.sessions.filter((item) => item.sessionId !== entry.sessionId);
    const sessions = [entry, ...rest].slice(0, SESSIONS_MAX);
    this.state = { ...this.state, sessions };
    await this.flush();
  }
  async logActivity(kind, message) {
    const entry = { at: Date.now(), kind, text: message.slice(0, 200) };
    this.state = { ...this.state, activity: [...this.state.activity, entry].slice(-ACTIVITY_MAX) };
    await this.flush();
  }
  async flush() {
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile2(temp, JSON.stringify(this.state, null, 2), { encoding: "utf8", mode: 384 });
    await rename(temp, this.file);
  }
}

// node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);
var wrapper_default = import_websocket.default;

// service/dingtalk/stream.ts
var DEFAULT_API_BASE = "https://api.dingtalk.com";
var DEFAULT_HEARTBEAT_MS = 30000;
var DEFAULT_CONNECT_TIMEOUT_MS = 20000;
var RECONNECT_MIN_MS = 1000;
var RECONNECT_MAX_MS = 60000;
var DEDUPE_TTL_MS = 5 * 60000;
var DEDUPE_CAP = 512;
function nonEmpty3(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function reconnectDelay(attempt) {
  const exponential = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential * (0.8 + Math.random() * 0.4));
}

class DingTalkStream {
  options;
  log;
  WebSocketImpl;
  socket = null;
  stopped = false;
  state = "idle";
  heartbeatTimer = null;
  reconnectTimer = null;
  alive = false;
  reconnectAttempts = 0;
  messagesReceived = 0;
  duplicatesDropped = 0;
  registered = false;
  frames = { system: 0, callback: 0, event: 0, other: 0 };
  lastConnectedAt = null;
  lastCallbackAt = null;
  lastFrameAt = null;
  lastTopic = null;
  lastError = null;
  seen = new Map;
  startedPromise = null;
  onAbort = null;
  constructor(options) {
    this.options = options;
    this.log = options.logger ?? console;
    this.WebSocketImpl = options.webSocketImpl ?? wrapper_default;
  }
  get connected() {
    return this.state === "connected" && this.socket !== null && this.socket.readyState === 1;
  }
  status() {
    return {
      state: this.state,
      connected: this.connected,
      registered: this.registered,
      messagesReceived: this.messagesReceived,
      duplicatesDropped: this.duplicatesDropped,
      frames: { ...this.frames },
      lastConnectedAt: this.lastConnectedAt,
      lastCallbackAt: this.lastCallbackAt,
      lastFrameAt: this.lastFrameAt,
      lastTopic: this.lastTopic,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts
    };
  }
  emitState() {
    try {
      this.options.onStateChange?.(this.status());
    } catch {}
  }
  async start() {
    if (this.startedPromise)
      return this.startedPromise;
    this.stopped = false;
    const abort = this.options.signal;
    if (abort?.aborted) {
      this.state = "stopped";
      return;
    }
    this.onAbort = () => {
      this.stop();
    };
    abort?.addEventListener("abort", this.onAbort, { once: true });
    this.startedPromise = this.connect(true).finally(() => {
      this.startedPromise = null;
    });
    return this.startedPromise;
  }
  async stop() {
    this.stopped = true;
    this.state = "stopped";
    this.emitState();
    if (this.onAbort && this.options.signal) {
      this.options.signal.removeEventListener("abort", this.onAbort);
      this.onAbort = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.removeAllListeners();
        socket.close();
      } catch {}
    }
  }
  async connect(isFirst) {
    if (this.stopped)
      return;
    this.state = isFirst ? "connecting" : "reconnecting";
    try {
      const ticket = await this.openConnection();
      if (this.stopped)
        return;
      await this.openSocket(ticket.endpoint, ticket.ticket);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      if (isFirst) {
        this.state = "failed";
        this.emitState();
        throw error;
      }
      this.log.warn(`[钉钉] stream reconnect failed: ${this.lastError}`);
      this.scheduleReconnect();
    }
  }
  async openConnection() {
    const { clientId, clientSecret } = this.options.credentials;
    const apiBase = (this.options.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
    const controller = new AbortController;
    const timer = setTimeout(() => controller.abort(), this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
    timer.unref?.();
    try {
      const response = await fetch(`${apiBase}/v1.0/gateway/connections/open`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          clientId,
          clientSecret,
          ua: "openchamber-dingtalk/1.0",
          subscriptions: [
            { type: "CALLBACK", topic: TOPIC_ROBOT },
            { type: "CALLBACK", topic: TOPIC_CARD }
          ]
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`钉钉 Stream 握手失败（HTTP ${response.status}）`);
      }
      const value = await response.json();
      const endpoint = nonEmpty3(value.endpoint);
      const ticket = nonEmpty3(value.ticket);
      if (!endpoint || !ticket)
        throw new Error("钉钉 Stream 握手没有返回连接地址");
      return { endpoint, ticket };
    } finally {
      clearTimeout(timer);
    }
  }
  openSocket(endpoint, ticket) {
    return new Promise((resolve, reject) => {
      const url = `${endpoint}?ticket=${ticket}`;
      let settled = false;
      const socket = new this.WebSocketImpl(url, { followRedirects: false });
      this.socket = socket;
      const connectTimer = setTimeout(() => {
        if (settled)
          return;
        settled = true;
        this.lastError = "钉钉 Stream 连接超时";
        try {
          socket.terminate();
        } catch {}
        reject(new Error(this.lastError ?? "钉钉 Stream 连接超时"));
      }, this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
      connectTimer.unref?.();
      socket.on("open", () => {
        if (settled)
          return;
        settled = true;
        clearTimeout(connectTimer);
        this.state = "connected";
        this.reconnectAttempts = 0;
        this.connectedAt();
        this.startHeartbeat();
        this.emitState();
        resolve();
      });
      socket.on("message", (data) => {
        this.onFrame(data.toString());
      });
      socket.on("pong", () => {
        this.alive = true;
      });
      socket.on("error", (error) => {
        this.lastError = error.message;
        if (!settled) {
          settled = true;
          clearTimeout(connectTimer);
          reject(error);
        }
      });
      socket.on("close", () => {
        clearTimeout(connectTimer);
        if (this.socket !== socket)
          return;
        this.socket = null;
        this.stopHeartbeat();
        if (!settled) {
          settled = true;
          reject(new Error("钉钉 Stream 连接已关闭"));
        }
        if (!this.stopped) {
          this.state = "reconnecting";
          this.emitState();
          this.scheduleReconnect();
        }
      });
    });
  }
  connectedAt() {
    this.lastConnectedAt = new Date().toISOString();
    this.log.log("[钉钉] Stream 已连接");
  }
  startHeartbeat() {
    this.stopHeartbeat();
    this.alive = true;
    const interval = this.options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
    this.heartbeatTimer = setInterval(() => {
      const socket = this.socket;
      if (!socket || socket.readyState !== 1)
        return;
      if (!this.alive) {
        this.log.warn("[钉钉] Stream 心跳超时，重建连接");
        try {
          socket.terminate();
        } catch {}
        return;
      }
      this.alive = false;
      try {
        socket.ping();
      } catch {}
    }, interval);
    this.heartbeatTimer.unref?.();
  }
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer)
      return;
    this.reconnectAttempts++;
    const delayMs = reconnectDelay(this.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(false);
    }, delayMs);
    this.reconnectTimer.unref?.();
  }
  send(frame) {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1)
      return;
    try {
      socket.send(JSON.stringify(frame));
    } catch (error) {
      this.log.warn(`[钉钉] Stream 回执发送失败: ${String(error)}`);
    }
  }
  ack(messageId, payload = { response: { success: true } }) {
    if (!messageId)
      return;
    this.send({
      code: 200,
      headers: { contentType: "application/json", messageId },
      message: "OK",
      data: JSON.stringify(payload)
    });
  }
  onFrame(raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      this.log.warn("[钉钉] Stream 收到无法解析的帧");
      return;
    }
    const topic = typeof frame.headers?.topic === "string" ? frame.headers.topic : null;
    this.lastFrameAt = new Date().toISOString();
    this.lastTopic = topic;
    if (frame.type === "SYSTEM")
      this.frames.system++;
    else if (frame.type === "CALLBACK")
      this.frames.callback++;
    else if (frame.type === "EVENT")
      this.frames.event++;
    else
      this.frames.other++;
    if (frame.type === "SYSTEM" && topic === "REGISTERED")
      this.registered = true;
    if (frame.type === "CALLBACK")
      this.registered = true;
    try {
      const diagnostic = {
        type: typeof frame.type === "string" ? frame.type : "unknown",
        topic,
        ...typeof frame.headers?.messageId === "string" ? { messageId: frame.headers.messageId } : {}
      };
      if (frame.type === "CALLBACK") {
        let payload = frame.data;
        try {
          payload = typeof frame.data === "string" ? JSON.parse(frame.data) : frame.data;
        } catch {
          payload = undefined;
        }
        if (payload && typeof payload === "object") {
          const record = payload;
          diagnostic.payload = {
            keys: Object.keys(record).slice(0, 40),
            ...typeof record.msgtype === "string" ? { msgtype: record.msgtype } : {},
            ...typeof record.conversationType === "string" ? { conversationType: record.conversationType } : {},
            hasMsgId: typeof record.msgId === "string" && record.msgId.length > 0,
            hasSenderStaffId: typeof record.senderStaffId === "string" && record.senderStaffId.length > 0,
            hasSenderId: typeof record.senderId === "string" && record.senderId.length > 0,
            hasText: !!record.text && typeof record.text === "object"
          };
        }
      }
      this.options.onFrame?.(diagnostic);
    } catch {}
    if (frame.type === "SYSTEM") {
      if (topic === "ping") {
        this.send({ code: 200, headers: frame.headers, message: "OK", data: frame.data });
        this.alive = true;
        return;
      }
      if (topic === "KEEPALIVE" || topic === "REGISTERED" || topic === "CONNECTED") {
        this.alive = true;
        return;
      }
      if (topic === "disconnect") {
        this.state = "reconnecting";
        return;
      }
      return;
    }
    if (frame.type === "CALLBACK") {
      const messageId = frame.headers?.messageId;
      this.ack(messageId);
      if (!this.admit(messageId))
        return;
      this.lastCallbackAt = new Date().toISOString();
      this.messagesReceived++;
      if (topic === TOPIC_CARD) {
        let cardPayload = frame.data;
        if (typeof frame.data === "string") {
          try {
            cardPayload = JSON.parse(frame.data);
          } catch {
            this.log.warn("[钉钉] Stream 卡片回调数据无法解析");
            return;
          }
        }
        try {
          this.options.onCardCallback?.(cardPayload);
        } catch (error) {
          this.log.error(`[钉钉] Stream 卡片回调处理失败: ${String(error)}`);
        }
        return;
      }
      let payload = frame.data;
      if (typeof frame.data === "string") {
        try {
          payload = JSON.parse(frame.data);
        } catch {
          this.log.warn("[钉钉] Stream 回调数据无法解析");
          return;
        }
      }
      try {
        this.options.onMessage(payload);
      } catch (error) {
        this.log.error(`[钉钉] Stream 回调处理失败: ${String(error)}`);
      }
    }
  }
  admit(messageId) {
    if (!messageId)
      return true;
    const now = Date.now();
    for (const [id, at] of this.seen) {
      if (now - at > DEDUPE_TTL_MS)
        this.seen.delete(id);
      else
        break;
    }
    if (this.seen.has(messageId)) {
      this.duplicatesDropped++;
      return false;
    }
    this.seen.set(messageId, now);
    while (this.seen.size > DEDUPE_CAP) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined)
        break;
      this.seen.delete(oldest);
    }
    return true;
  }
}

// service/spool.ts
import { mkdir as mkdir3, readFile as readFile3, readdir, rename as rename2, rm, writeFile as writeFile3 } from "node:fs/promises";
import os2 from "node:os";
import path4 from "node:path";
var SPOOL_HOME_ENV = "OPENCHAMBER_DINGTALK_HOME";
var RESULT_KEEP = 50;
function spoolRoot(env = process.env) {
  const custom = (env[SPOOL_HOME_ENV] ?? "").trim();
  if (custom)
    return custom;
  return path4.join(os2.homedir(), ".openchamber-dingtalk");
}
function statusFile(env = process.env) {
  return path4.join(spoolRoot(env), "status.json");
}
function outboxDir(env = process.env) {
  return path4.join(spoolRoot(env), "outbox");
}
function resultsDir(env = process.env) {
  return path4.join(spoolRoot(env), "results");
}
async function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile3(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 384 });
  await rename2(temp, file);
}
async function writeBridgeStatus(status, env) {
  const file = statusFile(env);
  await mkdir3(path4.dirname(file), { recursive: true });
  await writeJsonAtomic(file, status);
}
async function drainOutbox(env) {
  const dir = outboxDir(env);
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    const file = path4.join(dir, name);
    try {
      const raw = JSON.parse(await readFile3(file, "utf8"));
      if (!raw || typeof raw !== "object" || typeof raw.id !== "string")
        throw new Error("任务格式不对");
      entries.push({
        file,
        job: {
          v: 1,
          id: raw.id,
          at: Number(raw.at) || 0,
          ...typeof raw.text === "string" ? { text: raw.text } : {},
          ...Array.isArray(raw.files) ? { files: raw.files.filter((item) => typeof item === "string") } : {}
        }
      });
    } catch {
      await rename2(file, `${file}.bad`).catch(() => {
        return;
      });
    }
  }
  return entries;
}
async function removeOutboxJob(file) {
  await rm(file, { force: true });
}
async function writeOutboxResult(id, result, env) {
  const dir = resultsDir(env);
  await mkdir3(dir, { recursive: true });
  await writeJsonAtomic(path4.join(dir, `${id}.json`), result);
  try {
    const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
    for (const name of names.slice(0, Math.max(0, names.length - RESULT_KEEP))) {
      await rm(path4.join(dir, name), { force: true }).catch(() => {
        return;
      });
    }
  } catch {}
}

// service/main.ts
var PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT ?? 0);
var TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN ?? "";
var DATA_DIR = resolveDataDir(process.env);
var OUTBOX_INTERVAL_MS = 4000;
var RETRY_FAILED_CONNECT_MS = 60000;
var log = (message) => {
  console.log(`[钉钉] ${message}`);
};
var host = createServiceHost({ env: process.env });
var store;
var bridge;
var stream = null;
var streamStatus = null;
var retryTimer = null;
var emitTimer = null;
function emitState() {
  if (emitTimer)
    return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    publishStatus();
    host.emit("state", statusPayload()).catch(() => {
      return;
    });
  }, 250);
  emitTimer.unref?.();
}
async function publishStatus() {
  const settings = store.settings;
  const binding = store.binding;
  await writeBridgeStatus({
    v: 1,
    at: Date.now(),
    configured: !!settings.clientId && !!settings.clientSecret,
    enabled: settings.enabled,
    connected: !!streamStatus?.connected,
    bound: !!binding,
    ...binding ? { userId: binding.userId, sessionId: binding.sessionId } : {}
  }).catch(() => {
    return;
  });
}
async function pumpOutbox() {
  await publishStatus();
  const entries = await drainOutbox().catch(() => []);
  for (const entry of entries) {
    const fail = async (error) => {
      log(`插件投递失败：${error}`);
      await store.logActivity("error", `插件投递失败：${error}`).catch(() => {
        return;
      });
      await writeOutboxResult(entry.job.id, { at: Date.now(), ok: false, error }).catch(() => {
        return;
      });
      await removeOutboxJob(entry.file).catch(() => {
        return;
      });
    };
    if (!store.binding) {
      await fail("钉钉里还没有绑定用户");
      continue;
    }
    if (!bridge.configured) {
      await fail("钉钉桥接还没配置 AppKey / AppSecret");
      continue;
    }
    try {
      await bridge.sendOutboxJob(entry.job);
      await writeOutboxResult(entry.job.id, { at: Date.now(), ok: true }).catch(() => {
        return;
      });
    } catch (error) {
      await fail(error instanceof Error ? error.message : String(error));
    } finally {
      await removeOutboxJob(entry.file).catch(() => {
        return;
      });
    }
  }
}
function statusPayload() {
  const settings = store.settings;
  return {
    configured: !!settings.clientId && !!settings.clientSecret,
    enabled: settings.enabled,
    clientId: settings.clientId,
    hasSecret: !!settings.clientSecret,
    robotCode: settings.robotCode || settings.clientId,
    cardTemplate: !!settings.cardTemplateId,
    directory: settings.directory,
    allowedUsers: settings.allowedUsers,
    notifyOtherSessions: settings.notifyOtherSessions,
    stream: streamStatus ? {
      state: streamStatus.state,
      connected: streamStatus.connected,
      registered: streamStatus.registered,
      lastError: streamStatus.lastError,
      lastFrameAt: streamStatus.lastFrameAt,
      lastCallbackAt: streamStatus.lastCallbackAt,
      messages: streamStatus.messagesReceived,
      reconnects: streamStatus.reconnectAttempts
    } : null,
    ...bridge.snapshot()
  };
}
async function stopStream() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const current = stream;
  stream = null;
  if (current)
    await current.stop().catch(() => {
      return;
    });
  streamStatus = null;
}
async function startStream() {
  const settings = store.settings;
  if (!settings.enabled || !settings.clientId || !settings.clientSecret) {
    return;
  }
  if (stream)
    return;
  const client = new DingTalkStream({
    credentials: { clientId: settings.clientId, clientSecret: settings.clientSecret },
    onMessage: (payload) => bridge.handleInbound(payload),
    logger: console,
    onStateChange: (status) => {
      streamStatus = status;
      emitState();
    }
  });
  stream = client;
  try {
    await client.start();
    await host.needsConfiguration(null).catch(() => {
      return;
    });
    log("Stream 已启动");
    emitState();
  } catch (error) {
    log(`Stream 启动失败：${error instanceof Error ? error.message : String(error)}`);
    streamStatus = client.status();
    stream = null;
    await client.stop().catch(() => {
      return;
    });
    if (retryTimer)
      clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      startStream();
    }, RETRY_FAILED_CONNECT_MS);
    retryTimer.unref?.();
    emitState();
  }
}
async function restartStream() {
  await stopStream();
  await startStream();
  emitState();
}
function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2000000) {
        reject(new Error("请求体过大"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
function json(response, status, value) {
  const body = JSON.stringify(value ?? {});
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(body);
}
function parseSettingsPatch(body) {
  const raw = JSON.parse(body || "{}");
  const patch = {};
  for (const key of ["clientId", "clientSecret", "robotCode", "cardTemplateId", "directory"]) {
    if (typeof raw[key] === "string")
      patch[key] = raw[key];
  }
  if (Array.isArray(raw.allowedUsers)) {
    patch.allowedUsers = raw.allowedUsers.filter((item) => typeof item === "string");
  } else if (typeof raw.allowedUsers === "string") {
    patch.allowedUsers = raw.allowedUsers.split(/[,，\s]+/).filter(Boolean);
  }
  if (typeof raw.enabled === "boolean")
    patch.enabled = raw.enabled;
  if (typeof raw.notifyOtherSessions === "boolean")
    patch.notifyOtherSessions = raw.notifyOtherSessions;
  return patch;
}
async function route(pathname, method, body) {
  if (pathname === "/status" && method === "GET") {
    return { status: 200, value: statusPayload() };
  }
  if (pathname === "/config" && method === "POST") {
    const patch = parseSettingsPatch(body);
    const before = store.settings;
    const after = await store.patchSettings(patch);
    const credentialsChanged = before.clientId !== after.clientId || before.clientSecret !== after.clientSecret || before.robotCode !== after.robotCode || before.enabled !== after.enabled;
    if (!after.clientId || !after.clientSecret) {
      await host.needsConfiguration("在「钉钉桥接」面板里填入 AppKey、AppSecret 和 RobotCode。").catch(() => {
        return;
      });
    }
    if (credentialsChanged) {
      await restartStream();
    } else if (after.clientId && after.clientSecret && !stream) {
      await startStream();
    } else {
      emitState();
    }
    return { status: 200, value: statusPayload() };
  }
  if (pathname === "/disconnect" && method === "POST") {
    await stopStream();
    await store.patchSettings({ enabled: false });
    emitState();
    return { status: 200, value: statusPayload() };
  }
  if (pathname === "/unbind" && method === "POST") {
    await store.setBinding(null);
    await store.logActivity("state", "在面板里解除了绑定");
    emitState();
    return { status: 200, value: statusPayload() };
  }
  if (pathname === "/session-events" && method === "POST") {
    const request = readSessionEventRequest(body);
    if (!request)
      return { status: 400, value: { ok: false, error: "无法识别的会话事件" } };
    setImmediate(() => {
      bridge.handleEvent(request).catch((error) => {
        log(`处理会话事件失败：${error instanceof Error ? error.message : String(error)}`);
      });
    });
    return { status: 200, value: { ok: true } };
  }
  return null;
}
var server = http.createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${TOKEN}`) {
    response.writeHead(401).end();
    return;
  }
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/health") {
    json(response, 200, { ok: true });
    return;
  }
  const method = (request.method ?? "GET").toUpperCase();
  readJson(request).then((body) => route(pathname, method, body).then((answer) => {
    if (!answer)
      json(response, 404, { error: "not found" });
    else
      json(response, answer.status, answer.value);
  }, (error) => {
    log(`路由失败 ${pathname}：${error instanceof Error ? error.message : String(error)}`);
    json(response, 500, { error: "内部错误" });
  }), () => json(response, 400, { error: "请求体无法读取" }));
});
async function main() {
  store = await ConfigStore.open(DATA_DIR);
  bridge = new Bridge({
    store,
    host,
    dataDir: DATA_DIR,
    log,
    onStateChange: emitState
  });
  server.listen(PORT, "127.0.0.1", () => {
    log(`服务已启动，端口 ${PORT}`);
  });
  await publishStatus();
  pumpOutbox();
  const pumpTimer = setInterval(() => {
    pumpOutbox();
  }, OUTBOX_INTERVAL_MS);
  pumpTimer.unref?.();
  const settings = store.settings;
  if (!settings.clientId || !settings.clientSecret) {
    await host.needsConfiguration("在「钉钉桥接」面板里填入 AppKey、AppSecret 和 RobotCode。").catch(() => {
      return;
    });
  } else {
    await host.needsConfiguration(null).catch(() => {
      return;
    });
    startStream();
  }
}
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    (async () => {
      await bridge?.shutdown().catch(() => {
        return;
      });
      await stopStream();
      await rm2(statusFile(), { force: true }).catch(() => {
        return;
      });
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    })();
  });
}
main().catch((error) => {
  log(`启动失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
