import { ChannelType } from 'pushoo';

export type Config = {
    channels?: ChannelConfig[]
    channel_groups?: ChannelGroupConfig[]
    default_channel?: string
    auth?: AuthConfig
    webhooks?: WebhookConfig
}

export type ChannelConfig = {
    name: string
    type: ChannelType
    token: string
}

export type ChannelGroupConfig = {
    name: string
    use?: string[] // uses other channel or groups
}

export type AuthConfig = {
    user: string
    pass: string
}

export type WebhookConfig = {
    tawk?: TawkWebhookConfig
}

export type TawkWebhookConfig = {
    secret?: string
    chan?: string
    title?: string
}
