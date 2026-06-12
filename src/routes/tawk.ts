import logger from '@shims/logger';
import { Router } from 'itty-router';

import { getConfig } from '@config/index';
import { Config } from '@config/type';
import { RequestShim } from '@shims/request';
import { pushByChanString } from '@shims/push';

type TawkPayload = {
    event?: string
    chatId?: string
    time?: string
    domain?: string
    referrer?: string
    message?: {
        text?: string
        type?: string
        sender?: {
            type?: string
        }
    }
    visitor?: TawkVisitor
    requester?: TawkVisitor
    property?: {
        id?: string
        name?: string
    }
    chat?: {
        id?: string
        visitor?: TawkVisitor
        messages?: TawkTranscriptMessage[]
    }
    ticket?: {
        id?: string
        humanId?: string | number
        subject?: string
        message?: string
    }
}

type TawkVisitor = {
    name?: string
    email?: string
    city?: string
    country?: string
}

type TawkTranscriptMessage = {
    sender?: {
        t?: string
        n?: string
    }
    type?: string
    msg?: string
    time?: string
    attchs?: unknown[]
}

type RequestWithHeaders = RequestShim & {
    headers: Headers
}

const router = Router({ base: '/webhook/tawk' });

const textValue = (value: unknown) => (
    typeof value === 'string' || typeof value === 'number' ? String(value) : ''
);

const line = (label: string, value: unknown) => {
    const text = textValue(value);
    return text ? `${label}: ${text}` : '';
};

const getVisitor = (payload: TawkPayload): TawkVisitor => (
    payload.visitor || payload.chat?.visitor || payload.requester || {}
);

const getChatId = (payload: TawkPayload) => (
    payload.chatId || payload.chat?.id || payload.ticket?.id || ''
);

const getEventLabel = (event: string) => {
    const labels: { [index: string]: string } = {
        'chat:start': '新聊天开始',
        'chat:end': '聊天结束',
        'chat:transcript_created': '聊天记录生成',
        'ticket:create': '新工单创建',
    };
    return labels[event] || event || 'Tawk.to 事件';
};

const getSenderName = (message: TawkTranscriptMessage) => {
    const sender = message.sender;
    if (!sender) return '未知';
    if (sender.n) return sender.n;
    if (sender.t === 'a') return '客服';
    if (sender.t === 'v') return '访客';
    if (sender.t === 's') return '系统';
    return sender.t || '未知';
};

const formatTranscript = (messages: TawkTranscriptMessage[] | undefined) => {
    if (!Array.isArray(messages) || !messages.length) {
        return '';
    }

    return messages
        .slice(-20)
        .map((message) => {
            const content = message.msg || (message.attchs?.length ? '[附件]' : '');
            if (!content) return '';
            return `- ${getSenderName(message)}: ${content}`;
        })
        .filter(Boolean)
        .join('\n');
};

const formatTawkPayload = (payload: TawkPayload, defaultTitle: string) => {
    const event = payload.event || 'tawk:webhook';
    const visitor = getVisitor(payload);
    const eventLabel = getEventLabel(event);
    const title = `${defaultTitle} - ${eventLabel}`;
    const chatId = getChatId(payload);

    const headerLines = [
        line('事件', `${eventLabel} (${event})`),
        line('时间', payload.time),
        line('站点', payload.domain),
        line('来源', payload.referrer),
        line('Property', payload.property?.name || payload.property?.id),
        line('Chat ID', chatId),
        line('访客', visitor.name),
        line('邮箱', visitor.email),
        line('地区', [visitor.city, visitor.country].filter(Boolean).join(', ')),
    ].filter(Boolean);

    const bodyLines = [...headerLines];

    if (payload.message?.text) {
        bodyLines.push('', '首条消息:', payload.message.text);
    }

    if (payload.ticket) {
        bodyLines.push(
            '',
            line('工单编号', payload.ticket.humanId || payload.ticket.id),
            line('工单主题', payload.ticket.subject),
            line('工单内容', payload.ticket.message),
        );
    }

    const transcript = formatTranscript(payload.chat?.messages);
    if (transcript) {
        bodyLines.push('', '聊天记录:', transcript);
    }

    return {
        title,
        desp: bodyLines.filter((item) => item !== undefined).join('\n'),
    };
};

const getOptionalString = (...values: unknown[]) => {
    for (const value of values) {
        const text = textValue(value).trim();
        if (text) return text;
    }
    return undefined;
};

const toArrayBuffer = (buffer: Buffer) => (
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
);

const toHex = (buffer: ArrayBuffer) => (
    Array.from(new Uint8Array(buffer))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
);

const verifySignature = async (body: Buffer, signature: string | undefined, secret: string) => {
    if (!signature) return false;

    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign'],
    );
    const digest = await crypto.subtle.sign('HMAC', cryptoKey, toArrayBuffer(body));
    return toHex(digest) === signature.toLowerCase();
};

router.all('*', async (req: RequestShim) => {
    if (req.method !== 'POST') {
        return {
            status: 405,
            body: JSON.stringify({ msg: 'Method Not Allowed' }, null, 4),
            headers: {
                'content-type': 'application/json; charset=utf-8',
            },
        };
    }

    const request = req as RequestWithHeaders;
    const config = await getConfig() as Config;
    const payload = req.bodyobj as unknown as TawkPayload;
    const query = req.query_ || req.query || {};
    const channame = getOptionalString(query.chan, config.webhooks?.tawk?.chan);
    const titlePrefix = getOptionalString(query.title, config.webhooks?.tawk?.title) || 'Tawk.to';
    const secret = getOptionalString(query.secret, config.webhooks?.tawk?.secret);

    const dolog = (logmsg: string) => {
        logger.reqlog(req, 'tawk: ' + logmsg);
    };

    if (secret) {
        const isValid = await verifySignature(
            req.rawBodyBuf,
            request.headers.get('X-Tawk-Signature') || undefined,
            secret,
        );

        if (!isValid) {
            dolog('signature verification failed');
            return {
                status: 401,
                body: JSON.stringify({ msg: 'Invalid signature' }, null, 4),
                headers: {
                    'content-type': 'application/json; charset=utf-8',
                },
            };
        }
    }

    const { title, desp } = formatTawkPayload(payload, titlePrefix);
    logger.info("Got tawk webhook request: \n"
                + `    event: ${payload.event ?? 'undefined'}\n`
                + `    title: ${title}\n`
                + `    chan: ${channame ?? 'undefined'}\n`
                );

    let results: string[] = [];
    try {
        results = await pushByChanString(channame, title, desp, dolog);
    } catch(e) {
        const _e = <Error>e;
        dolog("unknown error during tawk webhook send: " + _e.toString());
    }

    logger.info(`Got tawk results: ${JSON.stringify(results)} logs: ${JSON.stringify(req.logs)}`);
    return {
        status: results.length ? 200 : 500,
        body: JSON.stringify({
            results: results.length ? results : undefined,
            msg: req.logs.length ? req.logs : undefined,
        }, null, 4),
        headers: {
            'content-type': 'application/json; charset=utf-8',
        },
    };
});

export default router;
