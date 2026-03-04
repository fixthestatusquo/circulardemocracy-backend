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
// src/stalwart.ts - Stalwart MTA Hook Worker
var zod_openapi_1 = require("@hono/zod-openapi");
var cors_1 = require("hono/cors");
var database_1 = require("./database");
// =============================================================================
// STALWART MTA HOOK SCHEMAS
// =============================================================================
var StalwartHookSchema = zod_openapi_1.z.object({
    messageId: zod_openapi_1.z.string().describe('Stalwart internal message ID'),
    queueId: zod_openapi_1.z.string().optional().describe('Queue ID for tracking'),
    sender: zod_openapi_1.z.string().email().describe('Envelope sender'),
    recipients: zod_openapi_1.z.array(zod_openapi_1.z.string().email()).describe('All envelope recipients'),
    headers: zod_openapi_1.z.record(zod_openapi_1.z.string(), zod_openapi_1.z.union([zod_openapi_1.z.string(), zod_openapi_1.z.array(zod_openapi_1.z.string())]))
        .describe('All email headers'),
    subject: zod_openapi_1.z.string().optional(),
    body: zod_openapi_1.z.object({
        text: zod_openapi_1.z.string().optional().describe('Plain text body'),
        html: zod_openapi_1.z.string().optional().describe('HTML body')
    }).optional(),
    size: zod_openapi_1.z.number().describe('Message size in bytes'),
    timestamp: zod_openapi_1.z.number().describe('Unix timestamp when received'),
    spf: zod_openapi_1.z.object({
        result: zod_openapi_1.z.enum(['pass', 'fail', 'softfail', 'neutral', 'temperror', 'permerror', 'none']),
        domain: zod_openapi_1.z.string().optional()
    }).optional(),
    dkim: zod_openapi_1.z.array(zod_openapi_1.z.object({
        result: zod_openapi_1.z.enum(['pass', 'fail', 'temperror', 'permerror', 'neutral', 'none']),
        domain: zod_openapi_1.z.string().optional(),
        selector: zod_openapi_1.z.string().optional()
    })).optional(),
    dmarc: zod_openapi_1.z.object({
        result: zod_openapi_1.z.enum(['pass', 'fail', 'temperror', 'permerror', 'none']),
        policy: zod_openapi_1.z.enum(['none', 'quarantine', 'reject']).optional()
    }).optional()
});
var StalwartResponseSchema = zod_openapi_1.z.object({
    action: zod_openapi_1.z.enum(['accept', 'reject', 'quarantine', 'discard']),
    modifications: zod_openapi_1.z.object({
        folder: zod_openapi_1.z.string().optional().describe('IMAP folder to store message'),
        headers: zod_openapi_1.z.record(zod_openapi_1.z.string(), zod_openapi_1.z.string()).optional(),
        subject: zod_openapi_1.z.string().optional()
    }).optional(),
    reject_reason: zod_openapi_1.z.string().optional(),
    confidence: zod_openapi_1.z.number().min(0).max(1).optional()
});
// =============================================================================
// STALWART WORKER APP
// =============================================================================
var app = new zod_openapi_1.OpenAPIHono();
// CORS middleware
app.use('/*', (0, cors_1.cors)({
    origin: ['https://*.circulardemocracy.org', 'http://localhost:*'],
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['POST', 'GET', 'OPTIONS'],
}));
// Database client middleware
app.use('*', function (c, next) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                c.set('db', new database_1.DatabaseClient({
                    url: c.env.SUPABASE_URL,
                    key: c.env.SUPABASE_KEY
                }));
                return [4 /*yield*/, next()];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
// =============================================================================
// MTA HOOK ROUTE
// =============================================================================
var mtaHookRoute = (0, zod_openapi_1.createRoute)({
    method: 'post',
    path: '/mta-hook',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: StalwartHookSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: StalwartResponseSchema,
                },
            },
            description: 'Instructions for message handling',
        },
        500: {
            content: {
                'application/json': {
                    schema: zod_openapi_1.z.object({
                        action: zod_openapi_1.z.literal('accept'),
                        error: zod_openapi_1.z.string()
                    }),
                },
            },
            description: 'Error - default to accept',
        },
    },
    tags: ['Stalwart'],
    summary: 'MTA Hook for incoming emails',
    description: 'Processes incoming emails and provides routing instructions'
});
app.openapi(mtaHookRoute, function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var db, hookData_1, senderEmail_1, senderName_1, results, bestResult, error_1;
    var _a, _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                db = c.get('db');
                _c.label = 1;
            case 1:
                _c.trys.push([1, 3, , 4]);
                hookData_1 = c.req.valid('json');
                console.log("Processing email: ".concat(hookData_1.messageId, " from ").concat(hookData_1.sender));
                senderEmail_1 = extractSenderEmail(hookData_1);
                senderName_1 = extractSenderName(hookData_1);
                return [4 /*yield*/, Promise.all(hookData_1.recipients.map(function (recipientEmail) { return __awaiter(void 0, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, processEmailForRecipient(db, c.env.AI, hookData_1, senderEmail_1, senderName_1, recipientEmail)];
                                case 1: return [2 /*return*/, _a.sent()];
                            }
                        });
                    }); }))
                    // Use the result with highest confidence
                ];
            case 2:
                results = _c.sent();
                bestResult = results.reduce(function (best, current) {
                    return (current.confidence || 0) > (best.confidence || 0) ? current : best;
                });
                console.log("Email processed: campaign=".concat((_b = (_a = bestResult.modifications) === null || _a === void 0 ? void 0 : _a.headers) === null || _b === void 0 ? void 0 : _b['X-CircularDemocracy-Campaign'], ", confidence=").concat(bestResult.confidence));
                return [2 /*return*/, c.json(bestResult)];
            case 3:
                error_1 = _c.sent();
                console.error('MTA Hook processing error:', error_1);
                // Always accept on error to avoid email loss
                return [2 /*return*/, c.json({
                        action: 'accept',
                        error: error_1 instanceof Error ? error_1.message : 'Unknown error'
                    }, 500)];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Health check
app.get('/health', function (c) {
    return c.json({
        status: 'ok',
        service: 'stalwart-hook',
        timestamp: new Date().toISOString()
    });
});
// =============================================================================
// EMAIL PROCESSING LOGIC
// =============================================================================
function processEmailForRecipient(db, ai, hookData, senderEmail, senderName, recipientEmail) {
    return __awaiter(this, void 0, void 0, function () {
        var isDuplicate, politician, messageContent, embedding, classification, senderHash, duplicateRank, messageData, folderName, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 8, , 9]);
                    return [4 /*yield*/, db.checkExternalIdExists(hookData.messageId, 'stalwart')];
                case 1:
                    isDuplicate = _a.sent();
                    if (isDuplicate) {
                        return [2 /*return*/, {
                                action: 'accept',
                                confidence: 1.0,
                                modifications: {
                                    folder: 'CircularDemocracy/System/Duplicates',
                                    headers: { 'X-CircularDemocracy-Status': 'duplicate' }
                                }
                            }];
                    }
                    return [4 /*yield*/, db.findPoliticianByEmail(recipientEmail)];
                case 2:
                    politician = _a.sent();
                    if (!politician) {
                        return [2 /*return*/, {
                                action: 'accept',
                                confidence: 0.0,
                                modifications: {
                                    folder: 'CircularDemocracy/System/Unknown',
                                    headers: { 'X-CircularDemocracy-Status': 'politician-not-found' }
                                }
                            }];
                    }
                    messageContent = extractMessageContent(hookData);
                    if (messageContent.length < 10) {
                        return [2 /*return*/, {
                                action: 'accept',
                                confidence: 0.1,
                                modifications: {
                                    folder: 'CircularDemocracy/System/TooShort',
                                    headers: { 'X-CircularDemocracy-Status': 'message-too-short' }
                                }
                            }];
                    }
                    return [4 /*yield*/, generateEmbedding(ai, messageContent)];
                case 3:
                    embedding = _a.sent();
                    return [4 /*yield*/, db.classifyMessage(embedding)
                        // Step 5: Check for logical duplicates
                    ];
                case 4:
                    classification = _a.sent();
                    return [4 /*yield*/, (0, database_1.hashEmail)(senderEmail)];
                case 5:
                    senderHash = _a.sent();
                    return [4 /*yield*/, db.getDuplicateRank(senderHash, politician.id, classification.campaign_id)
                        // Step 6: Store message metadata
                    ];
                case 6:
                    duplicateRank = _a.sent();
                    messageData = {
                        external_id: hookData.messageId,
                        channel: 'email',
                        channel_source: 'stalwart',
                        politician_id: politician.id,
                        sender_hash: senderHash,
                        campaign_id: classification.campaign_id,
                        classification_confidence: classification.confidence,
                        message_embedding: embedding,
                        language: 'auto', // TODO: detect language
                        received_at: new Date(hookData.timestamp * 1000).toISOString(),
                        duplicate_rank: duplicateRank,
                        processing_status: 'processed'
                    };
                    return [4 /*yield*/, db.insertMessage(messageData)
                        // Step 7: Generate folder and response
                    ];
                case 7:
                    _a.sent();
                    folderName = generateFolderName(classification, duplicateRank);
                    return [2 /*return*/, {
                            action: 'accept',
                            confidence: classification.confidence,
                            modifications: {
                                folder: folderName,
                                headers: {
                                    'X-CircularDemocracy-Campaign': classification.campaign_name,
                                    'X-CircularDemocracy-Confidence': classification.confidence.toString(),
                                    'X-CircularDemocracy-Duplicate-Rank': duplicateRank.toString(),
                                    'X-CircularDemocracy-Message-ID': hookData.messageId,
                                    'X-CircularDemocracy-Politician': politician.name,
                                    'X-CircularDemocracy-Status': 'processed'
                                }
                            }
                        }];
                case 8:
                    error_2 = _a.sent();
                    console.error("Error processing email for ".concat(recipientEmail, ":"), error_2);
                    return [2 /*return*/, {
                            action: 'accept',
                            confidence: 0.0,
                            modifications: {
                                folder: 'CircularDemocracy/System/ProcessingError',
                                headers: {
                                    'X-CircularDemocracy-Status': 'error',
                                    'X-CircularDemocracy-Error': error_2 instanceof Error ? error_2.message : 'unknown'
                                }
                            }
                        }];
                case 9: return [2 /*return*/];
            }
        });
    });
}
// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================
function extractSenderEmail(hookData) {
    var _a;
    // Priority: Reply-To > From > envelope sender (SPF considerations)
    var replyTo = getHeader(hookData.headers, 'reply-to');
    if (replyTo && isValidEmail(replyTo)) {
        return replyTo;
    }
    var from = getHeader(hookData.headers, 'from');
    if (from) {
        var emailMatch = from.match(/<([^>]+)>/) || [null, from];
        var email = (_a = emailMatch[1]) === null || _a === void 0 ? void 0 : _a.trim();
        if (email && isValidEmail(email)) {
            return email;
        }
    }
    return hookData.sender;
}
function extractSenderName(hookData) {
    var from = getHeader(hookData.headers, 'from');
    if (from) {
        var nameMatch = from.match(/^([^<]+)</);
        if (nameMatch) {
            return nameMatch[1].trim().replace(/^["']|["']$/g, '');
        }
    }
    var email = extractSenderEmail(hookData);
    return email.split('@')[0];
}
function extractMessageContent(hookData) {
    var _a, _b;
    // Prefer plain text over HTML
    var textContent = (_a = hookData.body) === null || _a === void 0 ? void 0 : _a.text;
    if (textContent && textContent.trim().length > 0) {
        return cleanTextContent(textContent);
    }
    var htmlContent = (_b = hookData.body) === null || _b === void 0 ? void 0 : _b.html;
    if (htmlContent) {
        return cleanHtmlContent(htmlContent);
    }
    return hookData.subject || '';
}
function cleanTextContent(text) {
    return text
        .replace(/^>.*$/gm, '') // Remove quoted lines
        .replace(/^\s*On .* wrote:\s*$/gm, '') // Remove reply headers
        .replace(/\n{3,}/g, '\n\n') // Normalize newlines
        .trim();
}
function cleanHtmlContent(html) {
    return html
        .replace(/<[^>]*>/g, ' ') // Strip HTML tags
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
}
function getHeader(headers, name) {
    var value = headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] || null : value || null;
}
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function generateFolderName(classification, duplicateRank) {
    var baseFolder = 'CircularDemocracy';
    var campaignFolder = classification.campaign_name
        .replace(/[^a-zA-Z0-9\-_\s]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50); // Limit folder name length
    if (duplicateRank > 0) {
        return "".concat(baseFolder, "/").concat(campaignFolder, "/Duplicates");
    }
    if (classification.confidence < 0.3) {
        return "".concat(baseFolder, "/").concat(campaignFolder, "/LowConfidence");
    }
    return "".concat(baseFolder, "/").concat(campaignFolder);
}
function generateEmbedding(ai, text) {
    return __awaiter(this, void 0, void 0, function () {
        var response, error_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, ai.run('@cf/baai/bge-m3', {
                            text: text.substring(0, 8000)
                        })];
                case 1:
                    response = _a.sent();
                    return [2 /*return*/, response.data[0]];
                case 2:
                    error_3 = _a.sent();
                    console.error('Embedding generation error:', error_3);
                    throw new Error('Failed to generate message embedding');
                case 3: return [2 /*return*/];
            }
        });
    });
}
// OpenAPI documentation
app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
        version: '1.0.0',
        title: 'Stalwart MTA Hook API',
        description: 'Processes incoming emails via Stalwart mail server hooks'
    },
    servers: [
        {
            url: 'https://stalwart.circulardemocracy.org',
            description: 'Production Stalwart hook server'
        }
    ]
});
exports.default = app;
