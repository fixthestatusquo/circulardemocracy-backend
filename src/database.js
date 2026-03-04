"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.DatabaseClient = void 0;
exports.hashEmail = hashEmail;
var supabase_js_1 = require("@supabase/supabase-js");
var DatabaseClient = /** @class */ (function () {
    function DatabaseClient(config) {
        this.supabase = (0, supabase_js_1.createClient)(config.url, config.key);
    }
    DatabaseClient.prototype.request = function (endpoint_1) {
        return __awaiter(this, arguments, void 0, function (endpoint, options) {
            var query, _a, data, error;
            if (options === void 0) { options = {}; }
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        console.log("supab" + endpoint);
                        query = this.supabase.from(endpoint).select('*');
                        return [4 /*yield*/, query];
                    case 1:
                        _a = _b.sent(), data = _a.data, error = _a.error;
                        if (error) {
                            throw new Error("Database error: ".concat(error.message));
                        }
                        return [2 /*return*/, data];
                }
            });
        });
    };
    // =============================================================================
    // POLITICIAN OPERATIONS
    // =============================================================================
    DatabaseClient.prototype.findPoliticianByEmail = function (email) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, exactMatch, exactError, _b, arrayMatch, arrayError, error_1;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _c.trys.push([0, 3, , 4]);
                        return [4 /*yield*/, this.supabase
                                .from('politicians')
                                .select('id,name,email,additional_emails')
                                .eq('email', email)
                                .eq('active', true)];
                    case 1:
                        _a = _c.sent(), exactMatch = _a.data, exactError = _a.error;
                        if (exactError)
                            throw exactError;
                        if (exactMatch.length > 0)
                            return [2 /*return*/, exactMatch[0]];
                        return [4 /*yield*/, this.supabase
                                .from('politicians')
                                .select('id,name,email,additional_emails')
                                .contains('additional_emails', [email])
                                .eq('active', true)];
                    case 2:
                        _b = _c.sent(), arrayMatch = _b.data, arrayError = _b.error;
                        if (arrayError)
                            throw arrayError;
                        return [2 /*return*/, arrayMatch.length > 0 ? arrayMatch[0] : null];
                    case 3:
                        error_1 = _c.sent();
                        console.error('Error finding politician:', error_1);
                        return [2 /*return*/, null];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    // =============================================================================
    // CAMPAIGN OPERATIONS
    // =============================================================================
    DatabaseClient.prototype.findCampaignByHint = function (hint) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, campaigns, error, error_2;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.supabase
                                .from('campaigns')
                                .select('id,name,slug,status,reference_vector')
                                .or("name.ilike.*".concat(hint, "*,slug.ilike.*").concat(hint, "*"))
                                .in('status', ['active', 'unconfirmed'])
                                .limit(1)];
                    case 1:
                        _a = _b.sent(), campaigns = _a.data, error = _a.error;
                        if (error)
                            throw error;
                        return [2 /*return*/, campaigns.length > 0 ? campaigns[0] : null];
                    case 2:
                        error_2 = _b.sent();
                        console.error('Error finding campaign by hint:', error_2);
                        return [2 /*return*/, null];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    DatabaseClient.prototype.findSimilarCampaigns = function (embedding_1) {
        return __awaiter(this, arguments, void 0, function (embedding, limit) {
            var _a, data, error, error_3, _b, fallback, fallbackError;
            if (limit === void 0) { limit = 3; }
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _c.trys.push([0, 2, , 4]);
                        return [4 /*yield*/, this.supabase.rpc('find_similar_campaigns', {
                                query_embedding: embedding,
                                similarity_threshold: 0.1,
                                match_limit: limit,
                            })];
                    case 1:
                        _a = _c.sent(), data = _a.data, error = _a.error;
                        if (error)
                            throw error;
                        return [2 /*return*/, data];
                    case 2:
                        error_3 = _c.sent();
                        console.error('Error finding similar campaigns:', error_3);
                        return [4 /*yield*/, this.supabase
                                .from('campaigns')
                                .select('id,name,slug,status')
                                .in('status', ['active', 'unconfirmed'])
                                .not('reference_vector', 'is', null)
                                .limit(limit)];
                    case 3:
                        _b = _c.sent(), fallback = _b.data, fallbackError = _b.error;
                        if (fallbackError)
                            throw fallbackError;
                        return [2 /*return*/, fallback.map(function (camp) { return (__assign(__assign({}, camp), { similarity: 0.1 })); })];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    DatabaseClient.prototype.getUncategorizedCampaign = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, campaigns, error, _b, newCampaigns, createError, error_4;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _c.trys.push([0, 3, , 4]);
                        return [4 /*yield*/, this.supabase
                                .from('campaigns')
                                .select('id,name,slug,status')
                                .eq('slug', 'uncategorized')];
                    case 1:
                        _a = _c.sent(), campaigns = _a.data, error = _a.error;
                        if (error)
                            throw error;
                        if (campaigns.length > 0)
                            return [2 /*return*/, campaigns[0]];
                        return [4 /*yield*/, this.supabase
                                .from('campaigns')
                                .insert({
                                name: 'Uncategorized',
                                slug: 'uncategorized',
                                description: 'Messages that could not be automatically categorized',
                                status: 'active',
                                created_by: 'system',
                            })
                                .select()];
                    case 2:
                        _b = _c.sent(), newCampaigns = _b.data, createError = _b.error;
                        if (createError)
                            throw createError;
                        return [2 /*return*/, newCampaigns[0]];
                    case 3:
                        error_4 = _c.sent();
                        console.error('Error getting uncategorized campaign:', error_4);
                        throw new Error('Failed to get or create uncategorized campaign');
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    // =============================================================================
    // MESSAGE OPERATIONS
    // =============================================================================
    DatabaseClient.prototype.getDuplicateRank = function (senderHash, politicianId, campaignId) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, count, error, error_5;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.supabase
                                .from('messages')
                                .select('*', { count: 'exact', head: true })
                                .eq('sender_hash', senderHash)
                                .eq('politician_id', politicianId)
                                .eq('campaign_id', campaignId)];
                    case 1:
                        _a = _b.sent(), count = _a.count, error = _a.error;
                        if (error)
                            throw error;
                        return [2 /*return*/, count || 0];
                    case 2:
                        error_5 = _b.sent();
                        console.error('Error getting duplicate rank:', error_5);
                        return [2 /*return*/, 0];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    DatabaseClient.prototype.insertMessage = function (data) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, result, error, error_6;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.supabase
                                .from('messages')
                                .insert(data)
                                .select('id')];
                    case 1:
                        _a = _b.sent(), result = _a.data, error = _a.error;
                        if (error)
                            throw error;
                        return [2 /*return*/, result[0].id];
                    case 2:
                        error_6 = _b.sent();
                        console.error('Error inserting message:', error_6);
                        throw new Error('Failed to store message in database');
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    DatabaseClient.prototype.checkExternalIdExists = function (externalId, channelSource) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, data, error, error_7;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.supabase
                                .from('messages')
                                .select('id')
                                .eq('external_id', externalId)
                                .eq('channel_source', channelSource)
                                .limit(1)];
                    case 1:
                        _a = _b.sent(), data = _a.data, error = _a.error;
                        if (error)
                            throw error;
                        return [2 /*return*/, data.length > 0];
                    case 2:
                        error_7 = _b.sent();
                        console.error('Error checking external ID:', error_7);
                        return [2 /*return*/, false];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    // =============================================================================
    // CLASSIFICATION LOGIC
    // =============================================================================
    DatabaseClient.prototype.classifyMessage = function (embedding, campaignHint) {
        return __awaiter(this, void 0, void 0, function () {
            var hintCampaign, similarCampaigns, best, uncategorized;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!campaignHint) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.findCampaignByHint(campaignHint)];
                    case 1:
                        hintCampaign = _a.sent();
                        if (hintCampaign) {
                            return [2 /*return*/, {
                                    campaign_id: hintCampaign.id,
                                    campaign_name: hintCampaign.name,
                                    confidence: 0.95,
                                }];
                        }
                        _a.label = 2;
                    case 2: return [4 /*yield*/, this.findSimilarCampaigns(embedding, 3)];
                    case 3:
                        similarCampaigns = _a.sent();
                        if (similarCampaigns.length > 0) {
                            best = similarCampaigns[0];
                            // If similarity is high enough, use existing campaign
                            if (best.similarity > 0.7) {
                                return [2 /*return*/, {
                                        campaign_id: best.id,
                                        campaign_name: best.name,
                                        confidence: best.similarity,
                                    }];
                            }
                        }
                        return [4 /*yield*/, this.getUncategorizedCampaign()];
                    case 4:
                        uncategorized = _a.sent();
                        return [2 /*return*/, {
                                campaign_id: uncategorized.id,
                                campaign_name: uncategorized.name,
                                confidence: 0.1,
                            }];
                }
            });
        });
    };
    return DatabaseClient;
}());
exports.DatabaseClient = DatabaseClient;
// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================
function hashEmail(email) {
    return __awaiter(this, void 0, void 0, function () {
        var encoder, data, hashBuffer, hashArray;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    encoder = new TextEncoder();
                    data = encoder.encode(email.toLowerCase().trim());
                    return [4 /*yield*/, crypto.subtle.digest('SHA-256', data)];
                case 1:
                    hashBuffer = _a.sent();
                    hashArray = Array.from(new Uint8Array(hashBuffer));
                    return [2 /*return*/, hashArray.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('')];
            }
        });
    });
}
// =============================================================================
// REQUIRED POSTGRESQL FUNCTIONS
// =============================================================================
/*
You'll need to create this PostgreSQL function in Supabase for vector similarity:

CREATE OR REPLACE FUNCTION find_similar_campaigns(
  query_embedding vector(1024),
  similarity_threshold float DEFAULT 0.1,
  match_limit int DEFAULT 3
)
RETURNS TABLE (
  id int,
  name text,
  slug text,
  status text,
  reference_vector vector(1024),
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.slug,
    c.status,
    c.reference_vector,
    (1 - (c.reference_vector <-> query_embedding)) as similarity
  FROM campaigns c
  WHERE c.reference_vector IS NOT NULL
    AND c.status IN ('active', 'unconfirmed')
    AND (1 - (c.reference_vector <-> query_embedding)) > similarity_threshold
  ORDER BY c.reference_vector <-> query_embedding
  LIMIT match_limit;
END;
$$;
*/
