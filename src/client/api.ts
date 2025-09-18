/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */

export type QueryParamsType = Record<string | number, any>;
export type ResponseFormat = keyof Omit<Body, "body" | "bodyUsed">;

export interface FullRequestParams extends Omit<RequestInit, "body"> {
  /** set parameter to `true` for call `securityWorker` for this request */
  secure?: boolean;
  /** request path */
  path: string;
  /** content type of request body */
  type?: ContentType;
  /** query params */
  query?: QueryParamsType;
  /** format of response (i.e. response.json() -> format: "json") */
  format?: ResponseFormat;
  /** request body */
  body?: unknown;
  /** base url */
  baseUrl?: string;
  /** request cancellation token */
  cancelToken?: CancelToken;
}

export type RequestParams = Omit<
  FullRequestParams,
  "body" | "method" | "query" | "path"
>;

export interface ApiConfig<SecurityDataType = unknown> {
  baseUrl?: string;
  baseApiParams?: Omit<RequestParams, "baseUrl" | "cancelToken" | "signal">;
  securityWorker?: (
    securityData: SecurityDataType | null,
  ) => Promise<RequestParams | void> | RequestParams | void;
  customFetch?: typeof fetch;
}

export interface HttpResponse<D extends unknown, E extends unknown = unknown>
  extends Response {
  data: D;
  error: E;
}

type CancelToken = Symbol | string | number;

export enum ContentType {
  Json = "application/json",
  JsonApi = "application/vnd.api+json",
  FormData = "multipart/form-data",
  UrlEncoded = "application/x-www-form-urlencoded",
  Text = "text/plain",
}

export class HttpClient<SecurityDataType = unknown> {
  public baseUrl: string = "https://api.circulardemocracy.org";
  private securityData: SecurityDataType | null = null;
  private securityWorker?: ApiConfig<SecurityDataType>["securityWorker"];
  private abortControllers = new Map<CancelToken, AbortController>();
  private customFetch = (...fetchParams: Parameters<typeof fetch>) =>
    fetch(...fetchParams);

  private baseApiParams: RequestParams = {
    credentials: "same-origin",
    headers: {},
    redirect: "follow",
    referrerPolicy: "no-referrer",
  };

  constructor(apiConfig: ApiConfig<SecurityDataType> = {}) {
    Object.assign(this, apiConfig);
  }

  public setSecurityData = (data: SecurityDataType | null) => {
    this.securityData = data;
  };

  protected encodeQueryParam(key: string, value: any) {
    const encodedKey = encodeURIComponent(key);
    return `${encodedKey}=${encodeURIComponent(typeof value === "number" ? value : `${value}`)}`;
  }

  protected addQueryParam(query: QueryParamsType, key: string) {
    return this.encodeQueryParam(key, query[key]);
  }

  protected addArrayQueryParam(query: QueryParamsType, key: string) {
    const value = query[key];
    return value.map((v: any) => this.encodeQueryParam(key, v)).join("&");
  }

  protected toQueryString(rawQuery?: QueryParamsType): string {
    const query = rawQuery || {};
    const keys = Object.keys(query).filter(
      (key) => "undefined" !== typeof query[key],
    );
    return keys
      .map((key) =>
        Array.isArray(query[key])
          ? this.addArrayQueryParam(query, key)
          : this.addQueryParam(query, key),
      )
      .join("&");
  }

  protected addQueryParams(rawQuery?: QueryParamsType): string {
    const queryString = this.toQueryString(rawQuery);
    return queryString ? `?${queryString}` : "";
  }

  private contentFormatters: Record<ContentType, (input: any) => any> = {
    [ContentType.Json]: (input: any) =>
      input !== null && (typeof input === "object" || typeof input === "string")
        ? JSON.stringify(input)
        : input,
    [ContentType.JsonApi]: (input: any) =>
      input !== null && (typeof input === "object" || typeof input === "string")
        ? JSON.stringify(input)
        : input,
    [ContentType.Text]: (input: any) =>
      input !== null && typeof input !== "string"
        ? JSON.stringify(input)
        : input,
    [ContentType.FormData]: (input: any) => {
      if (input instanceof FormData) {
        return input;
      }

      return Object.keys(input || {}).reduce((formData, key) => {
        const property = input[key];
        formData.append(
          key,
          property instanceof Blob
            ? property
            : typeof property === "object" && property !== null
              ? JSON.stringify(property)
              : `${property}`,
        );
        return formData;
      }, new FormData());
    },
    [ContentType.UrlEncoded]: (input: any) => this.toQueryString(input),
  };

  protected mergeRequestParams(
    params1: RequestParams,
    params2?: RequestParams,
  ): RequestParams {
    return {
      ...this.baseApiParams,
      ...params1,
      ...(params2 || {}),
      headers: {
        ...(this.baseApiParams.headers || {}),
        ...(params1.headers || {}),
        ...((params2 && params2.headers) || {}),
      },
    };
  }

  protected createAbortSignal = (
    cancelToken: CancelToken,
  ): AbortSignal | undefined => {
    if (this.abortControllers.has(cancelToken)) {
      const abortController = this.abortControllers.get(cancelToken);
      if (abortController) {
        return abortController.signal;
      }
      return void 0;
    }

    const abortController = new AbortController();
    this.abortControllers.set(cancelToken, abortController);
    return abortController.signal;
  };

  public abortRequest = (cancelToken: CancelToken) => {
    const abortController = this.abortControllers.get(cancelToken);

    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(cancelToken);
    }
  };

  public request = async <T = any, E = any>({
    body,
    secure,
    path,
    type,
    query,
    format,
    baseUrl,
    cancelToken,
    ...params
  }: FullRequestParams): Promise<HttpResponse<T, E>> => {
    const secureParams =
      ((typeof secure === "boolean" ? secure : this.baseApiParams.secure) &&
        this.securityWorker &&
        (await this.securityWorker(this.securityData))) ||
      {};
    const requestParams = this.mergeRequestParams(params, secureParams);
    const queryString = query && this.toQueryString(query);
    const payloadFormatter = this.contentFormatters[type || ContentType.Json];
    const responseFormat = format || requestParams.format;

    return this.customFetch(
      `${baseUrl || this.baseUrl || ""}${path}${queryString ? `?${queryString}` : ""}`,
      {
        ...requestParams,
        headers: {
          ...(requestParams.headers || {}),
          ...(type && type !== ContentType.FormData
            ? { "Content-Type": type }
            : {}),
        },
        signal:
          (cancelToken
            ? this.createAbortSignal(cancelToken)
            : requestParams.signal) || null,
        body:
          typeof body === "undefined" || body === null
            ? null
            : payloadFormatter(body),
      },
    ).then(async (response) => {
      const r = response as HttpResponse<T, E>;
      r.data = null as unknown as T;
      r.error = null as unknown as E;

      const responseToParse = responseFormat ? response.clone() : response;
      const data = !responseFormat
        ? r
        : await responseToParse[responseFormat]()
            .then((data) => {
              if (r.ok) {
                r.data = data;
              } else {
                r.error = data;
              }
              return r;
            })
            .catch((e) => {
              r.error = e;
              return r;
            });

      if (cancelToken) {
        this.abortControllers.delete(cancelToken);
      }

      if (!response.ok) throw data;
      return data;
    });
  };
}

/**
 * @title Circular Democracy API
 * @version 1.0.0
 * @baseUrl https://api.circulardemocracy.org
 *
 * API for processing citizen messages to politicians
 */
export class Api<
  SecurityDataType extends unknown,
> extends HttpClient<SecurityDataType> {
  api = {
    /**
     * @description Receives a citizen message, classifies it by campaign, and stores it for politician response
     *
     * @tags Messages
     * @name V1MessagesCreate
     * @summary Process incoming citizen message
     * @request POST:/api/v1/messages
     */
    v1MessagesCreate: (
      data: {
        /**
         * Unique identifier from source system
         * @minLength 1
         * @maxLength 255
         */
        external_id: string;
        /**
         * Full name of the message sender
         * @minLength 1
         * @maxLength 255
         */
        sender_name: string;
        /**
         * Email address of the sender
         * @format email
         * @maxLength 255
         */
        sender_email: string;
        /**
         * Email address of the target politician
         * @format email
         * @maxLength 255
         */
        recipient_email: string;
        /**
         * Message subject line
         * @maxLength 500
         */
        subject: string;
        /**
         * Message body content
         * @minLength 10
         * @maxLength 10000
         */
        message: string;
        /**
         * When the message was originally sent (ISO 8601)
         * @format date-time
         */
        timestamp: string;
        /**
         * Source system identifier
         * @maxLength 100
         */
        channel_source?: string;
        /**
         * Optional campaign name hint from sender
         * @maxLength 255
         */
        campaign_hint?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        {
          success: boolean;
          message_id?: number;
          status: "processed" | "failed" | "politician_not_found" | "duplicate";
          campaign_id?: number;
          campaign_name?: string;
          /**
           * @min 0
           * @max 1
           */
          confidence?: number;
          duplicate_rank?: number;
          errors?: string[];
        },
        | {
            /** @default false */
            success: boolean;
            error: string;
            details?: string;
          }
        | {
            success: boolean;
            message_id?: number;
            status:
              | "processed"
              | "failed"
              | "politician_not_found"
              | "duplicate";
            campaign_id?: number;
            campaign_name?: string;
            /**
             * @min 0
             * @max 1
             */
            confidence?: number;
            duplicate_rank?: number;
            errors?: string[];
          }
      >({
        path: `/api/v1/messages`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Campaigns
     * @name V1CampaignsList
     * @request GET:/api/v1/campaigns
     * @secure
     */
    v1CampaignsList: (params: RequestParams = {}) =>
      this.request<
        {
          id: number;
          name: string;
          slug: string;
          description: string | null;
          status: string;
          created_at: string;
        }[],
        any
      >({
        path: `/api/v1/campaigns`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Campaigns
     * @name V1CampaignsCreate
     * @request POST:/api/v1/campaigns
     * @secure
     */
    v1CampaignsCreate: (
      data: {
        /** @minLength 3 */
        name: string;
        /**
         * @minLength 3
         * @pattern ^[a-z0-9-]+$
         */
        slug: string;
        description?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        {
          id: number;
          name: string;
          slug: string;
          description: string | null;
          status: string;
          created_at: string;
        },
        any
      >({
        path: `/api/v1/campaigns`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Campaigns
     * @name V1CampaignsDetail
     * @request GET:/api/v1/campaigns/{id}
     * @secure
     */
    v1CampaignsDetail: (id: string, params: RequestParams = {}) =>
      this.request<
        {
          id: number;
          name: string;
          slug: string;
          description: string | null;
          status: string;
          created_at: string;
        },
        void
      >({
        path: `/api/v1/campaigns/${id}`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Campaigns, Statistics
     * @name V1CampaignsStatsList
     * @summary Get campaign statistics
     * @request GET:/api/v1/campaigns/stats
     * @secure
     */
    v1CampaignsStatsList: (params: RequestParams = {}) =>
      this.request<
        {
          campaigns: {
            id: number;
            name: string;
            message_count: number;
            recent_count: number;
            avg_confidence?: number;
          }[];
        },
        any
      >({
        path: `/api/v1/campaigns/stats`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Politicians
     * @name V1PoliticiansList
     * @request GET:/api/v1/politicians
     * @secure
     */
    v1PoliticiansList: (params: RequestParams = {}) =>
      this.request<
        {
          id: number;
          name: string;
          /** @format email */
          email: string;
          party: string | null;
          country: string | null;
          region: string | null;
          position: string | null;
          active: boolean;
        }[],
        any
      >({
        path: `/api/v1/politicians`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Politicians
     * @name V1PoliticiansDetail
     * @request GET:/api/v1/politicians/{id}
     * @secure
     */
    v1PoliticiansDetail: (id: string, params: RequestParams = {}) =>
      this.request<
        {
          id: number;
          name: string;
          /** @format email */
          email: string;
          party: string | null;
          country: string | null;
          region: string | null;
          position: string | null;
          active: boolean;
        },
        void
      >({
        path: `/api/v1/politicians/${id}`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Reply Templates
     * @name V1ReplyTemplatesList
     * @request GET:/api/v1/reply-templates
     * @secure
     */
    v1ReplyTemplatesList: (params: RequestParams = {}) =>
      this.request<
        {
          id: number;
          politician_id: number;
          campaign_id: number;
          name: string;
          subject: string;
          body: string;
          active: boolean;
        }[],
        any
      >({
        path: `/api/v1/reply-templates`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Reply Templates
     * @name V1ReplyTemplatesCreate
     * @request POST:/api/v1/reply-templates
     * @secure
     */
    v1ReplyTemplatesCreate: (
      data: {
        politician_id: number;
        campaign_id: number;
        name: string;
        subject: string;
        body: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        {
          id: number;
          politician_id: number;
          campaign_id: number;
          name: string;
          subject: string;
          body: string;
          active: boolean;
        },
        any
      >({
        path: `/api/v1/reply-templates`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Reply Templates
     * @name V1ReplyTemplatesDetail
     * @request GET:/api/v1/reply-templates/{id}
     * @secure
     */
    v1ReplyTemplatesDetail: (id: string, params: RequestParams = {}) =>
      this.request<
        {
          id: number;
          politician_id: number;
          campaign_id: number;
          name: string;
          subject: string;
          body: string;
          active: boolean;
        },
        void
      >({
        path: `/api/v1/reply-templates/${id}`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),
  };
}
