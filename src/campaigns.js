"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var zod_openapi_1 = require("@hono/zod-openapi");
var auth_1 = require("./auth");
var app = new zod_openapi_1.OpenAPIHono();
// =============================================================================
// SCHEMAS
// =============================================================================
var CampaignSchema = zod_openapi_1.z.object({
    id: zod_openapi_1.z.number(),
    name: zod_openapi_1.z.string(),
    slug: zod_openapi_1.z.string(),
    description: zod_openapi_1.z.string().nullable(),
    status: zod_openapi_1.z.string(),
    created_at: zod_openapi_1.z.string(),
});
var CreateCampaignSchema = zod_openapi_1.z.object({
    name: zod_openapi_1.z.string().min(3, 'Name must be at least 3 characters'),
    slug: zod_openapi_1.z.string().min(3, 'Slug must be at least 3 characters').regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
    description: zod_openapi_1.z.string().optional(),
});
// =============================================================================
// ROUTES
// =============================================================================
// List Campaigns
var listCampaignsRoute = (0, zod_openapi_1.createRoute)({
    method: 'get',
    path: '/api/v1/campaigns',
    security: [{ Bearer: [] }],
    responses: {
        200: {
            content: { 'application/json': { schema: zod_openapi_1.z.array(CampaignSchema) } },
            description: 'A list of campaigns',
        },
    },
    tags: ['Campaigns'],
});
app.openapi(listCampaignsRoute, auth_1.authMiddleware, function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var db, data;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                db = c.get('db');
                return [4 /*yield*/, db.request('/campaigns?select=*')];
            case 1:
                data = _a.sent();
                return [2 /*return*/, c.json(data)];
        }
    });
}); });
// Get campaign statistics
var statsRoute = (0, zod_openapi_1.createRoute)({
    method: 'get',
    path: '/api/v1/campaigns/stats',
    security: [{ Bearer: [] }],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: zod_openapi_1.z.object({
                        campaigns: zod_openapi_1.z.array(zod_openapi_1.z.object({
                            id: zod_openapi_1.z.number(),
                            name: zod_openapi_1.z.string(),
                            message_count: zod_openapi_1.z.number(),
                            recent_count: zod_openapi_1.z.number(),
                            avg_confidence: zod_openapi_1.z.number().optional(),
                        })),
                    }),
                },
            },
            description: 'Campaign statistics',
        },
    },
    tags: ['Campaigns', 'Statistics'], // Added Campaigns tag
    summary: 'Get campaign statistics',
});
app.openapi(statsRoute, auth_1.authMiddleware, function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var db, stats, _error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                db = c.get('db');
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                return [4 /*yield*/, db.request('/rpc/get_campaign_stats')];
            case 2:
                stats = _a.sent();
                return [2 /*return*/, c.json({ campaigns: stats })];
            case 3:
                _error_1 = _a.sent();
                return [2 /*return*/, c.json({ success: false, error: 'Failed to fetch statistics' }, 500)];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Get Single Campaign
var getCampaignRoute = (0, zod_openapi_1.createRoute)({
    method: 'get',
    path: '/api/v1/campaigns/{id}',
    security: [{ Bearer: [] }],
    request: {
        params: zod_openapi_1.z.object({ id: zod_openapi_1.z.string().regex(/^\d+$/) }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: CampaignSchema } },
            description: 'A single campaign',
        },
        404: { description: 'Campaign not found' },
    },
    tags: ['Campaigns'],
});
app.openapi(getCampaignRoute, auth_1.authMiddleware, function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var db, id, data;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                db = c.get('db');
                id = c.req.valid('param').id;
                return [4 /*yield*/, db.request("/campaigns?id=eq.".concat(id, "&select=*&limit=1"))];
            case 1:
                data = _a.sent();
                if (!data || data.length === 0) {
                    return [2 /*return*/, c.json({ error: 'Not found' }, 404)];
                }
                return [2 /*return*/, c.json(data[0])];
        }
    });
}); });
// Create Campaign
var createCampaignRoute = (0, zod_openapi_1.createRoute)({
    method: 'post',
    path: '/api/v1/campaigns',
    security: [{ Bearer: [] }],
    request: {
        body: { content: { 'application/json': { schema: CreateCampaignSchema } } },
    },
    responses: {
        201: {
            content: { 'application/json': { schema: CampaignSchema } },
            description: 'The created campaign',
        },
    },
    tags: ['Campaigns'],
});
app.openapi(createCampaignRoute, auth_1.authMiddleware, function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var db, campaignData, data;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                db = c.get('db');
                campaignData = c.req.valid('json');
                return [4 /*yield*/, db.request('/campaigns', {
                        method: 'POST',
                        body: JSON.stringify(campaignData),
                    })];
            case 1:
                data = _a.sent();
                return [2 /*return*/, c.json(data[0], 201)];
        }
    });
}); });
exports.default = app;
