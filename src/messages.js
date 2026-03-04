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
var database_1 = require("./database");
var app = new zod_openapi_1.OpenAPIHono();
// Schemas specific to message processing
var MessageInputSchema = zod_openapi_1.z.object({
    external_id: zod_openapi_1.z.string().min(1).max(255).describe('Unique identifier from source system'),
    sender_name: zod_openapi_1.z.string().min(1).max(255).describe('Full name of the message sender'),
    sender_email: zod_openapi_1.z.string().email().max(255).describe('Email address of the sender'),
    recipient_email: zod_openapi_1.z.string().email().max(255).describe('Email address of the target politician'),
    subject: zod_openapi_1.z.string().max(500).describe('Message subject line'),
    message: zod_openapi_1.z.string().min(10).max(10000).describe('Message body content'),
    timestamp: zod_openapi_1.z.string().datetime().describe('When the message was originally sent (ISO 8601)'),
    channel_source: zod_openapi_1.z.string().max(100).optional().describe('Source system identifier'),
    campaign_hint: zod_openapi_1.z.string().max(255).optional().describe('Optional campaign name hint from sender'),
});
var MessageResponseSchema = zod_openapi_1.z.object({
    success: zod_openapi_1.z.boolean(),
    message_id: zod_openapi_1.z.number().optional(),
    status: zod_openapi_1.z.enum(['processed', 'failed', 'politician_not_found', 'duplicate']),
    campaign_id: zod_openapi_1.z.number().optional(),
    campaign_name: zod_openapi_1.z.string().optional(),
    confidence: zod_openapi_1.z.number().min(0).max(1).optional(),
    duplicate_rank: zod_openapi_1.z.number().optional(),
    errors: zod_openapi_1.z.array(zod_openapi_1.z.string()).optional(),
});
var ErrorResponseSchema = zod_openapi_1.z.object({
    success: zod_openapi_1.z.boolean().default(false),
    error: zod_openapi_1.z.string(),
    details: zod_openapi_1.z.string().optional(),
});
// The message processing route definition
var messageRoute = (0, zod_openapi_1.createRoute)({
    method: 'post',
    path: '/api/v1/messages',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: MessageInputSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: MessageResponseSchema,
                },
            },
            description: 'Message processed successfully',
        },
        400: {
            content: {
                'application/json': {
                    schema: ErrorResponseSchema,
                },
            },
            description: 'Invalid input data',
        },
        404: {
            content: {
                'application/json': {
                    schema: MessageResponseSchema,
                },
            },
            description: 'Politician not found',
        },
        409: {
            content: {
                'application/json': {
                    schema: MessageResponseSchema,
                },
            },
            description: 'Duplicate message',
        },
        500: {
            content: {
                'application/json': {
                    schema: ErrorResponseSchema,
                },
            },
            description: 'Internal server error',
        },
    },
    tags: ['Messages'],
    summary: 'Process incoming citizen message',
    description: 'Receives a citizen message, classifies it by campaign, and stores it for politician response',
});
// The handler for the message route
app.openapi(messageRoute, function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var db, data, isDuplicate, politician, embedding, classification, senderHash, duplicateRank, messageData, messageId, error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                db = c.get('db');
                _a.label = 1;
            case 1:
                _a.trys.push([1, 9, , 10]);
                data = c.req.valid('json');
                return [4 /*yield*/, db.checkExternalIdExists(data.external_id, data.channel_source || 'unknown')];
            case 2:
                isDuplicate = _a.sent();
                if (isDuplicate) {
                    return [2 /*return*/, c.json({
                            success: false,
                            status: 'duplicate',
                            errors: ["Message with external_id ".concat(data.external_id, " already exists")],
                        }, 409)];
                }
                return [4 /*yield*/, db.findPoliticianByEmail(data.recipient_email)];
            case 3:
                politician = _a.sent();
                if (!politician) {
                    return [2 /*return*/, c.json({
                            success: false,
                            status: 'politician_not_found',
                            errors: ["No politician found for email: ".concat(data.recipient_email)],
                        }, 404)];
                }
                return [4 /*yield*/, generateEmbedding(c.env.AI, data.message)];
            case 4:
                embedding = _a.sent();
                return [4 /*yield*/, db.classifyMessage(embedding, data.campaign_hint)];
            case 5:
                classification = _a.sent();
                return [4 /*yield*/, (0, database_1.hashEmail)(data.sender_email)];
            case 6:
                senderHash = _a.sent();
                return [4 /*yield*/, db.getDuplicateRank(senderHash, politician.id, classification.campaign_id)];
            case 7:
                duplicateRank = _a.sent();
                messageData = {
                    external_id: data.external_id,
                    channel: 'api',
                    channel_source: data.channel_source || 'unknown',
                    politician_id: politician.id,
                    sender_hash: senderHash,
                    campaign_id: classification.campaign_id,
                    classification_confidence: classification.confidence,
                    message_embedding: embedding,
                    language: 'auto',
                    received_at: data.timestamp,
                    duplicate_rank: duplicateRank,
                    processing_status: 'processed',
                };
                return [4 /*yield*/, db.insertMessage(messageData)];
            case 8:
                messageId = _a.sent();
                return [2 /*return*/, c.json({
                        success: true,
                        message_id: messageId,
                        status: 'processed',
                        campaign_id: classification.campaign_id,
                        campaign_name: classification.campaign_name,
                        confidence: classification.confidence,
                        duplicate_rank: duplicateRank,
                    })];
            case 9:
                error_1 = _a.sent();
                console.error('Message processing error:', error_1);
                return [2 /*return*/, c.json({
                        success: false,
                        error: 'Internal server error',
                        details: error_1 instanceof Error ? error_1.message : 'Unknown error',
                    }, 500)];
            case 10: return [2 /*return*/];
        }
    });
}); });
function generateEmbedding(ai, text) {
    return __awaiter(this, void 0, void 0, function () {
        var response, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, ai.run('@cf/baai/bge-m3', {
                            text: text.substring(0, 8000), // Limit to avoid token limits
                        })];
                case 1:
                    response = _a.sent();
                    return [2 /*return*/, response.data[0]];
                case 2:
                    error_2 = _a.sent();
                    console.error('Embedding generation error:', error_2);
                    throw new Error('Failed to generate message embedding');
                case 3: return [2 /*return*/];
            }
        });
    });
}
exports.default = app;
