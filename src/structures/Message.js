'use strict';

const Base = require('./Base');
const MessageMedia = require('./MessageMedia');
const Location = require('./Location');
const { MessageTypes } = require('../util/Constants');

/**
 * Represents a Message on WhatsApp
 * @extends {Base}
 */
class Message extends Base {
    constructor(client, data) {
        super(client);

        if (data) this._patch(data);
    }

    _patch(data) {
        /**
         * MediaKey that represents the sticker 'ID'
         * @type {string}
         */
        this.mediaKey = data.mediaKey;


        /**
         * ID that represents the message
         * @type {object}
         */
        this.id = data.id;

        /**
         * ACK status for the message
         * @type {MessageAck}
         */
        this.ack = data.ack;

        /**
         * Indicates if the message has media available for download
         * @type {boolean}
         */
        this.hasMedia = data.clientUrl || data.deprecatedMms3Url ? true : false;


        // NEW!
        /** File size
          * @type {?number}
          */
        this.filesize = this.hasMedia ? data.size : null; 

        /**
         * Message content
         * @type {string}
         */
        this.body = this.hasMedia ? data.caption || '' : data.body || '';

        /** 
         * Message type
         * @type {MessageTypes}
         */
        this.type = data.type;

        /**
         * Unix timestamp for when the message was created
         * @type {number}
         */
        this.timestamp = data.t;

        /**
         * ID for the Chat that this message was sent to, except if the message was sent by the current user.
         * @type {string}
         */
        this.from = (typeof (data.from) === 'object' && data.from !== null) ? data.from._serialized : data.from;

        /**
         * ID for who this message is for.
         * 
         * If the message is sent by the current user, it will be the Chat to which the message is being sent.
         * If the message is sent by another user, it will be the ID for the current user. 
         * @type {string}
         */
        this.to = (typeof (data.to) === 'object' && data.to !== null) ? data.to._serialized : data.to;

        /**
         * If the message was sent to a group, this field will contain the user that sent the message.
         * @type {string}
         */
        this.author = (typeof (data.author) === 'object' && data.author !== null) ? data.author._serialized : data.author;

        /**
         * Indicates if the message was forwarded
         * @type {boolean}
         */
        this.isForwarded = data.isForwarded;

        /**
         * Indicates if the message is a status update
         * @type {boolean}
         */
        this.isStatus = data.isStatusV3;

        /**
         * Indicates if the message was starred
         * @type {boolean}
         */
        this.isStarred = data.star;
        
        /**
         * Indicates if the message was a broadcast
         * @type {boolean}
         */
        this.broadcast = data.broadcast;

        /** 
         * Indicates if the message was sent by the current user
         * @type {boolean}
         */
        this.fromMe = data.id.fromMe;

        /**
         * Indicates if the message was sent as a reply to another message.
         * @type {boolean}
         */
        this.hasQuotedMsg = data.quotedMsg ? true : false;

        /**
         * Location information contained in the message, if the message is type "location"
         * @type {Location}
         */
        this.location = data.type === MessageTypes.LOCATION ? new Location(data.lat, data.lng, data.loc) : undefined;

        /**
         * List of vCards contained in the message.
         * @type {Array<string>}
         */
        this.vCards = data.type === MessageTypes.CONTACT_CARD_MULTI ? data.vcardList.map((c) => c.vcard) : data.type === MessageTypes.CONTACT_CARD ? [data.body] : [];

        /**
         * Indicates the mentions in the message body.
         * @type {Array<string>}
         */
        this.mentionedIds = [];

        if (data.mentionedJidList) {
            this.mentionedIds = data.mentionedJidList;
        }

        /**
         * Links included in the message.
         * @type {Array<string>}
         */
        this.links = data.links;

        return super._patch(data);
    }

    _getChatId() {
        return this.fromMe ? this.to : this.from;
    }

    /**
     * Returns the Chat this message was sent in
     * @returns {Promise<Chat>}
     */
    getChat() {
        return this.client.getChatById(this._getChatId());
    }

    /**
     * Returns the Contact this message was sent from
     * @returns {Promise<Contact>}
     */
    getContact() {
        return this.client.getContactById(this.author || this.from);
    }

    /**
     * Returns the Contacts mentioned in this message
     * @returns {Promise<Array<Contact>>}
     */
    async getMentions() {
        return await Promise.all(this.mentionedIds.map(async m => await this.client.getContactById(m)));
    }

    /**
     * Returns the quoted message, if any
     * @returns {Promise<Message>}
     */
    async getQuotedMessage() {
        if (!this.hasQuotedMsg) return undefined;

        const quotedMsg = await this.client.pupPage.evaluate((msgId) => {
            let msg = window.Store.Msg.get(msgId);
            return msg.quotedMsgObj().serialize();
        }, this.id._serialized);

        return new Message(this.client, quotedMsg);
    }

    /**
     * Sends a message as a reply to this message. If chatId is specified, it will be sent 
     * through the specified Chat. If not, it will send the message 
     * in the same Chat as the original message was sent.
     * 
     * @param {string|MessageMedia|Location} content 
     * @param {string} [chatId] 
     * @param {MessageSendOptions} [options]
     * @returns {Promise<Message>}
     */
    async reply(content, chatId, options = {}) {
        if (!chatId) {
            chatId = this._getChatId();
        }

        options = {
            ...options,
            quotedMessageId: this.id._serialized
        };

        return this.client.sendMessage(chatId, content, options);
    }

    /**
     * Forwards this message to another chat
     * 
     * @param {string|Chat} chat Chat model or chat ID to which the message will be forwarded
     * @returns {Promise}
     */
    async forward(chat) {
        const chatId = typeof chat === 'string' ? chat : chat.id._serialized;

        await this.client.pupPage.evaluate(async (msgId, chatId) => {
            let msg = window.Store.Msg.get(msgId);
            let chat = window.Store.Chat.get(chatId);

            return await chat.forwardMessages([msg]);
        }, this.id._serialized, chatId);
    }

    /**
     * Downloads and returns the attatched message media
     * @returns {Promise<MessageMedia>}
     */
    async downloadMedia() {
        if (!this.hasMedia) {
            return undefined;
        }

        const result = await this.client.pupPage.evaluate(async (msgId) => {
            const msg = window.Store.Msg.get(msgId);

            if (msg.mediaData.mediaStage != 'RESOLVED') {
                // try to resolve media
                await msg.downloadMedia(true, 1);
            }

            if (msg.mediaData.mediaStage.includes('ERROR')) {
                // media could not be downloaded
                return undefined;
            }

            const mediaUrl = msg.clientUrl || msg.deprecatedMms3Url;

            const buffer = await window.WWebJS.downloadBuffer(mediaUrl);
            const decrypted = await window.Store.CryptoLib.decryptE2EMedia(msg.type, buffer, msg.mediaKey, msg.mimetype);
            const data = await window.WWebJS.readBlobAsync(decrypted._blob);

            return {
                data: data.split(',')[1],
                mimetype: msg.mimetype,
                filename: msg.filename,
                filesize: msg.size
            };

        }, this.id._serialized);

        if (!result) return undefined;
        return new MessageMedia(result.mimetype, result.data, result.filename, result.filesize);
    }

    /**
     * Deletes a message from the chat
     * @param {?boolean} everyone If true and the message is sent by the current user, will delete it for everyone in the chat.
     */
    async delete(everyone) {
        await this.client.pupPage.evaluate((msgId, everyone) => {
            let msg = window.Store.Msg.get(msgId);

            if (everyone && msg.id.fromMe && msg.canRevoke()) {
                return window.Store.Cmd.sendRevokeMsgs(msg.chat, [msg], true);
            }

            return window.Store.Cmd.sendDeleteMsgs(msg.chat, [msg], true);
        }, this.id._serialized, everyone);
    }

    /**
     * Stars this message
     */
    async star() {
        await this.client.pupPage.evaluate((msgId) => {
            let msg = window.Store.Msg.get(msgId);

            if (msg.canStar()) {
                return msg.chat.sendStarMsgs([msg], true);
            }
        }, this.id._serialized);
    }

    /**
     * Unstars this message
     */
    async unstar() {
        await this.client.pupPage.evaluate((msgId) => {
            let msg = window.Store.Msg.get(msgId);

            if (msg.canStar()) {
                return msg.chat.sendStarMsgs([msg], false);
            }
        }, this.id._serialized);
    }

    /**
     * Message Info
     * @typedef {Object} MessageInfo
     * @property {Array<{id: ContactId, t: number}>} delivery Contacts to which the message has been delivered to
     * @property {number} deliveryRemaining Amount of people to whom the message has not been delivered to
     * @property {Array<{id: ContactId, t: number}>} played Contacts who have listened to the voice message
     * @property {number} playedRemaining Amount of people who have not listened to the message
     * @property {Array<{id: ContactId, t: number}>} read Contacts who have read the message
     * @property {number} readRemaining Amount of people who have not read the message
     */

    /**
     * Get information about message delivery status. May return null if the message does not exist or is not sent by you.
     * @returns {Promise<?MessageInfo>}
     */
    async getInfo() {
        const info = await this.client.pupPage.evaluate(async (msgId) => {
            const msg = window.Store.Msg.get(msgId);
            if(!msg) return null;
            
            return await window.Store.Wap.queryMsgInfo(msg.id);
        }, this.id._serialized);

        if(info.status) {
            return null;
        }

        return info;
    }
}

module.exports = Message;
