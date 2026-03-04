"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var hono_1 = require("hono");
var api_1 = require("./api");
var stalwart_1 = require("./stalwart");
var app = new hono_1.Hono();
// Mount the stalwart app under the /stalwart route
app.route('/stalwart', stalwart_1.default);
// Mount the main API app at the root
app.route('/', api_1.default);
exports.default = app;
