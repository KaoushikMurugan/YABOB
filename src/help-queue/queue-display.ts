// @ts-expect-error the ascii table lib has no type
import { AsciiTable3, AlignmentEnum } from 'ascii-table3';
import { QueueViewModel } from './help-queue';
import { QueueChannel } from '../attending-server/base-attending-server';
import {
    Collection,
    MessageActionRow,
    MessageButton,
    MessageEmbed,
    MessageOptions,
    User
} from 'discord.js';
import { EmbedColor } from '../utils/embed-helper';

// The only responsibility is to interface with the ascii table
class QueueDisplayV2 {

    /**
     * keeps track of the actual embeds, key is render index
     * - queue has render index 0
     * - immediately updated in both requestQueueRender and requestNonQueueEmbedRender
    */
    private queueChannelEmbeds: Collection<
        number,
        {
            contents: Pick<MessageOptions, 'embeds' | 'components'>,
            renderIndex: number
        }
    > = new Collection();
    // key is renderIndex, value is message id
    private embedMessageIdMap: Collection<number, string> = new Collection();

    /**
     * lock any edits during cleanup
     * - there's a short timeframe where the channel has 0 messages
     * - any edits during that time will throw unknown message api error
    */
    private isCleaningUp = false;

    constructor(
        private readonly user: User,
        private readonly queueChannel: QueueChannel,
    ) { }

    async requestQueueRender(queue: QueueViewModel): Promise<void> {
        if (!this.queueChannel.channelObj.guild.channels.cache
            .has(this.queueChannel.channelObj.id)) {
            // temporary fix, do nothing if #queue doesn't exist
            return;
        }
        const embedTableMsg = new MessageEmbed();
        embedTableMsg
            .setTitle(`Queue for〚${queue.queueName}〛is\t${queue.isOpen
                ? "**OPEN**\t (ﾟ∀ﾟ )"
                : "**CLOSED**\t ◦<(¦3[▓▓]"}`)
            .setDescription(this.composeAsciiTable(queue))
            .setColor(queue.isOpen ? EmbedColor.Aqua : EmbedColor.Purple1);
        const joinLeaveButtons = new MessageActionRow()
            .addComponents(
                new MessageButton()
                    .setCustomId("join " + queue.queueName)
                    .setEmoji("✅")
                    .setDisabled(!queue.isOpen)
                    .setLabel("Join")
                    .setStyle("SUCCESS")
            )
            .addComponents(
                new MessageButton()
                    .setCustomId("leave " + queue.queueName)
                    .setEmoji("❎")
                    .setDisabled(!queue.isOpen)
                    .setLabel("Leave")
                    .setStyle("DANGER")
            );
        const notifButtons = new MessageActionRow()
            .addComponents(
                new MessageButton()
                    .setCustomId("notif " + queue.queueName)
                    .setEmoji("🔔")
                    .setLabel("Notify When Open")
                    .setStyle("PRIMARY")
            )
            .addComponents(
                new MessageButton()
                    .setCustomId("removeN " + queue.queueName)
                    .setEmoji("🔕")
                    .setLabel("Remove Notifications")
                    .setStyle("PRIMARY")
            );
        const embedList = [embedTableMsg];
        if (queue.helperIDs.length !== 0) {
            const helperList = new MessageEmbed();
            helperList
                .setTitle(`Currently available helpers`)
                .setDescription(queue.helperIDs.join('\n'));
            embedList.push(helperList);
        }
        this.queueChannelEmbeds.set(0, {
            contents: {
                embeds: embedList,
                components: [joinLeaveButtons, notifButtons]
            },
            renderIndex: 0
        });
        !this.isCleaningUp && await this.render();
    }

    async requestNonQueueEmbedRender(
        embedElements: Pick<MessageOptions, 'embeds' | 'components'>,
        renderIndex: number
    ): Promise<void> {
        if (!this.queueChannel.channelObj.guild.channels.cache
            .has(this.queueChannel.channelObj.id)) {
            // temporary fix, do nothing if #queue doesn't exist
            return;
        }
        this.queueChannelEmbeds.set(renderIndex, {
            contents: embedElements,
            renderIndex: renderIndex
        });
        !this.isCleaningUp && await this.render();
    }

    private async render(): Promise<void> {
        const queueMessages = await this.queueChannel
            .channelObj
            .messages
            .fetch();
        const YABOBMessages = queueMessages.filter(msg =>
            msg.author.id === this.user.id &&
            msg.type !== 'REPLY'
        );
        // If the channel doesn't have exactly all YABOB messages and the right amount, cleanup
        const messageCountMatch =
            YABOBMessages.size === queueMessages.size &&
            queueMessages.size === this.queueChannelEmbeds.size;
        const safeToEdit = messageCountMatch && YABOBMessages
            .every(message => this.embedMessageIdMap
                .some(id => id === message.id));
        if (!safeToEdit) {
            this.isCleaningUp = true;
            await Promise.all((await this.queueChannel.channelObj.messages.fetch())
                .map(msg => msg.delete()));
            // sort by render index
            const sortedEmbeds = this.queueChannelEmbeds
                .sort((embed1, embed2) => embed1.renderIndex - embed2.renderIndex);
            // Cannot promise all here, contents need to be sent in order
            for (const embed of sortedEmbeds.values()) {
                const newEmbedMessage = await this.queueChannel.channelObj.send(embed.contents);
                this.embedMessageIdMap.set(embed.renderIndex, newEmbedMessage.id);
            }
            this.isCleaningUp = false;
        } else {
            await Promise.all(this.queueChannelEmbeds.map(embed =>
                YABOBMessages
                    .get(this.embedMessageIdMap.get(embed.renderIndex) ?? '')
                    ?.edit(embed.contents)
            ));
        }
    }

    private composeAsciiTable(queue: QueueViewModel): string {
        const table = new AsciiTable3();
        if (queue.studentDisplayNames.length > 0) {
            table.setHeading('Position', 'Student Name')
                .setAlign(1, AlignmentEnum.CENTER)
                .setAlign(2, AlignmentEnum.CENTER)
                .setStyle('unicode-mix')
                .addRowMatrix([...queue.studentDisplayNames
                    .map((name, idx) => [idx === 0 ? `(☞°∀°)☞ 1` : `${idx + 1}`, name])
                ]);
        } else {
            const rand = Math.random();
            table.addRow('This Queue is Empty.')
                .setAlign(1, AlignmentEnum.CENTER)
                .setStyle('unicode-mix');
            if (rand <= 0.1) {
                table.addRow(`=^ Φ ω Φ ^=`);
            } else if (rand <= 0.2) {
                table.addRow(`Did you find the cat?`);
            }
        }
        return "```" + table.toString() + "```";
    }
}

export { QueueDisplayV2 };