/** @module BuiltInHandlers */

import {
    ChannelType,
    ChatInputCommandInteraction,
    GuildMember,
    TextChannel
} from 'discord.js';
import {
    EmbedColor,
    SimpleEmbed,
    ErrorEmbed,
    SlashCommandLogEmbed,
    ErrorLogEmbed
} from '../utils/embed-helper';
import { CommandParseError } from '../utils/error-types';
import {
    isTriggeredByUserWithRoles,
    hasValidQueueArgument,
    isFromGuildMember,
    isTriggeredByUserWithRolesSync,
    isServerInteraction
} from './common-validations';
import { convertMsToTime, logSlashCommand } from '../utils/util-functions';
// @ts-expect-error the ascii table lib has no type
import { AsciiTable3, AlignmentEnum } from 'ascii-table3';
import { CommandCallback, Optional } from '../utils/type-aliases';
import { adminCommandHelpMessages } from '../../help-channel-messages/AdminCommands';
import { helperCommandHelpMessages } from '../../help-channel-messages/HelperCommands';
import { studentCommandHelpMessages } from '../../help-channel-messages/StudentCommands';
import { afterSessionMessageModal, queueAutoClearModal } from './modal-objects';
import { ExpectedParseErrors } from './expected-interaction-errors';
import { SuccessMessages } from './builtin-success-messages';

/**
 * @packageDocumentation
 * Responsible for preprocessing commands and dispatching them to servers
 * ----
 * Each YABOB instance should only have 1 BuiltInCommandHandler
 * All the functions below follows this convention:
 * - async function <corresponding command name>(interaction): Promise<string>
 * @category Handler Classes
 * @param interaction the raw interaction
 * @throws CommandParseError: if command doesn't satify the checks in Promise.all
 * @throws QueueError or ServerError: if the target HelpQueueV2 or AttendingServer rejects
 */

/**
 * The map of available commands
 * Key is what the user will see, value is the arrow function
 * - undefined return values is when the method wants to reply to the interaction directly
 * - If a call returns undefined, processCommand won't edit the reply
 */
const methodMap: { [commandName: string]: CommandCallback } = {
    announce: announce,
    cleanup_queue: cleanup,
    cleanup_all: cleanupAllQueues,
    cleanup_help_channels: cleanupHelpChannel,
    clear: clear,
    clear_all: clearAll,
    enqueue: enqueue,
    leave: leave,
    list_helpers: listHelpers,
    next: next,
    queue: queue,
    start: start,
    stop: stop,
    help: help,
    set_logging_channel: setLoggingChannel,
    stop_logging: stopLogging,
    set_after_session_msg: showAfterSessionMessageModal,
    set_queue_auto_clear: showQueueAutoClearModal,
    serious_mode: setSeriousMode
} as const;

/**
 * Commands in this set only shows a modal on ChatInputCommandInteraction
 * Actual changes to attendingServers happens on modal submit
 * - See modal-handler.ts
 */
const showModalOnlyCommands = new Set<string>([
    'set_after_session_msg',
    'set_queue_auto_clear'
]);

function builtInCommandHandlerCanHandle(
    interaction: ChatInputCommandInteraction
): boolean {
    return interaction.commandName in methodMap;
}

/**
 * Main processor for command interactions
 * @param interaction the raw interaction from discord js
 */
async function processBuiltInCommand(
    interaction: ChatInputCommandInteraction
): Promise<void> {
    const server = isServerInteraction(interaction);
    const commandMethod = methodMap[interaction.commandName];
    if (!showModalOnlyCommands.has(interaction.commandName)) {
        // Immediately reply to show that YABOB has received the interaction
        // non modal commands only
        await interaction.reply({
            ...SimpleEmbed(
                `Processing command \`${interaction.commandName}\` ...`,
                EmbedColor.Neutral
            ),
            ephemeral: true
        });
    }
    logSlashCommand(interaction);
    await commandMethod?.(interaction)
        // shorthand syntax, if successMsg is undefined, don't run the rhs
        .then(async successMsg => {
            await Promise.all<unknown>([
                successMsg &&
                    interaction.editReply(SimpleEmbed(successMsg, EmbedColor.Success)),
                server.sendLogMessage(SlashCommandLogEmbed(interaction))
            ]);
        })
        .catch(async err => {
            // Central error handling, reply to user with the error
            await Promise.all([
                // if not replied (when using modals), reply
                interaction.replied
                    ? interaction.editReply(ErrorEmbed(err))
                    : interaction.reply({ ...ErrorEmbed(err), ephemeral: true }),
                server.sendLogMessage(ErrorLogEmbed(err, interaction))
            ]);
        });
}

/**
 * The `/queue add` and `/queue remove` command
 * @param interaction
 * @returns success message
 */
async function queue(interaction: ChatInputCommandInteraction): Promise<string> {
    const [server] = [
        isServerInteraction(interaction),
        await isTriggeredByUserWithRoles(
            interaction,
            `queue ${interaction.options.getSubcommand()}`,
            ['Bot Admin']
        )
    ];
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
        case 'add': {
            const queueName = interaction.options.getString('queue_name', true);
            await server.createQueue(queueName);
            return SuccessMessages.createdQueue(queueName);
        }
        case 'remove': {
            const targetQueue = hasValidQueueArgument(interaction, true);
            if (!interaction.channel || interaction.channel.isDMBased()) {
                throw ExpectedParseErrors.nonServerInterction();
            }
            if (interaction.channel.parentId === targetQueue.parentCategoryId) {
                throw ExpectedParseErrors.removeInsideQueue;
            }
            await server?.deleteQueueById(targetQueue.parentCategoryId);
            return SuccessMessages.deletedQueue(targetQueue.queueName);
        }
        default: {
            throw new CommandParseError(`Invalid /queue subcommand ${subcommand}.`);
        }
    }
}

/**
 * The `/enqueue command`
 * @param interaction
 * @returns
 */
async function enqueue(interaction: ChatInputCommandInteraction): Promise<string> {
    const [server, queueChannel, member] = [
        isServerInteraction(interaction),
        hasValidQueueArgument(interaction),
        isFromGuildMember(interaction)
    ];
    await server.enqueueStudent(member, queueChannel);
    return SuccessMessages.joinedQueue(queueChannel.queueName);
}

/**
 * The `/next` command, both with arguments or without arguments
 * @param interaction
 * @returns
 */
async function next(interaction: ChatInputCommandInteraction): Promise<string> {
    const [server, helperMember] = [
        isServerInteraction(interaction),
        isTriggeredByUserWithRolesSync(interaction, 'next', ['Bot Admin', 'Staff'])
    ];
    const targetQueue =
        interaction.options.getChannel('queue_name', false) === null
            ? undefined
            : hasValidQueueArgument(interaction, true);
    const targetStudent = (interaction.options.getMember('user') ??
        undefined) as Optional<GuildMember>;
    // if either target queue or target student is specified, use dequeueWithArgs
    // otherwise use dequeueGlobalFirst
    const dequeuedStudent =
        targetQueue || targetStudent
            ? await server?.dequeueWithArgs(helperMember, targetStudent, targetQueue)
            : await server.dequeueGlobalFirst(helperMember);
    return SuccessMessages.inviteSent(dequeuedStudent?.member.displayName);
}

/**
 * The `/start` command
 * @param interaction
 * @returns
 */
async function start(interaction: ChatInputCommandInteraction): Promise<string> {
    const [server, member] = [
        isServerInteraction(interaction),
        isTriggeredByUserWithRolesSync(interaction, 'start', ['Bot Admin', 'Staff'])
    ];
    const muteNotif = interaction.options.getBoolean('mute_notif') ?? false;
    await server.openAllOpenableQueues(member, !muteNotif);
    return SuccessMessages.startedHelping;
}

/**
 * The `/stop` command
 * @param interaction
 * @returns
 */
async function stop(interaction: ChatInputCommandInteraction): Promise<string> {
    const [server, member] = [
        isServerInteraction(interaction),
        isTriggeredByUserWithRolesSync(interaction, 'stop', ['Bot Admin', 'Staff'])
    ];
    const helpTimeEntry = await server.closeAllClosableQueues(member);
    return SuccessMessages.finishedHelping(helpTimeEntry);
}

/**
 * The `/leave queue` command
 * @param interaction
 * @returns
 */
async function leave(interaction: ChatInputCommandInteraction): Promise<string> {
    const [server, member, queue] = [
        isServerInteraction(interaction),
        isFromGuildMember(interaction),
        hasValidQueueArgument(interaction)
    ];
    await server.removeStudentFromQueue(member, queue);
    return SuccessMessages.leftQueue(queue.queueName);
}

/**
 * The `/clear queueName` command
 * @param interaction
 * @returns
 */
async function clear(interaction: ChatInputCommandInteraction): Promise<string> {
    const [server, queue, member] = [
        isServerInteraction(interaction),
        hasValidQueueArgument(interaction, true),
        await isTriggeredByUserWithRoles(interaction, 'clear', ['Bot Admin', 'Staff'])
    ];
    // if they are not admin or doesn't have the queue role, reject
    if (
        !member.roles.cache.some(
            role => role.name === queue.queueName || role.name === 'Bot Admin'
        )
    ) {
        throw ExpectedParseErrors.noPermission.clear(queue.queueName);
    }
    await server.clearQueue(queue);
    return SuccessMessages.clearedQueue(queue.queueName);
}

/**
 * The `/clear_all` command
 * @param interaction
 * @returns
 */
async function clearAll(interaction: ChatInputCommandInteraction): Promise<string> {
    const [server] = [
        isServerInteraction(interaction),
        await isTriggeredByUserWithRoles(interaction, 'clear_all', ['Bot Admin'])
    ];
    const allQueues = await server.getQueueChannels();
    if (allQueues.length === 0) {
        throw ExpectedParseErrors.serverHasNoQueue;
    }
    await server.clearAllQueues();
    return SuccessMessages.clearedAllQueues(server.guild.name);
}

/**
 * The `/list_helpers` command
 * @param interaction
 * @returns
 */
async function listHelpers(interaction: ChatInputCommandInteraction): Promise<undefined> {
    const server = isServerInteraction(interaction);
    const helpers = server.activeHelpers;
    if (helpers === undefined || helpers.size === 0) {
        await interaction.editReply(SimpleEmbed('No one is currently helping.'));
        return undefined;
    }
    const allQueues = await server.getQueueChannels();
    const table = new AsciiTable3()
        .setHeading('Tutor name', 'Availbale Queues', 'Time Elapsed', 'Status')
        .setAlign(1, AlignmentEnum.CENTER)
        .setAlign(2, AlignmentEnum.CENTER)
        .setAlign(3, AlignmentEnum.CENTER)
        .setAlign(4, AlignmentEnum.CENTER)
        .setStyle('unicode-mix')
        .addRowMatrix(
            [...helpers.values()].map(helper => [
                helper.member.displayName, // Tutor Name
                helper.member.roles.cache
                    .filter(
                        role =>
                            allQueues.find(queue => queue.queueName === role.name) !==
                            undefined
                    )
                    .map(role => role.name)
                    .toString(), // Available Queues
                convertMsToTime(new Date().valueOf() - helper.helpStart.valueOf()), // Time Elapsed
                (() => {
                    const voiceChannel = interaction.guild?.voiceStates.cache.get(
                        helper.member.id
                    )?.channel;
                    if (!voiceChannel) {
                        return 'Not in voice channel';
                    }
                    return voiceChannel.members.size > 1
                        ? `Busy in [${voiceChannel.name}]`
                        : `Idling in [${voiceChannel.name}]`;
                })() // Status, IIFE to cram in more logic
            ])
        )
        .setWidths([10, 10, 10, 10])
        .setWrapped(1)
        .setWrapped(2)
        .setWrapped(3)
        .setWrapped(4);
    await interaction.editReply(
        SimpleEmbed('Current Helpers', EmbedColor.Aqua, '```' + table.toString() + '```')
    );
    return undefined;
}

/**
 * The `/announce` command
 * @param interaction
 * @returns
 */
async function announce(interaction: ChatInputCommandInteraction): Promise<string> {
    const [server, member] = [
        isServerInteraction(interaction),
        await isTriggeredByUserWithRoles(interaction, 'announce', ['Bot Admin', 'Staff'])
    ];
    const announcement = interaction.options.getString('message', true);
    const optionalChannel = interaction.options.getChannel('queue_name', false);
    if (optionalChannel !== null) {
        const queueChannel = hasValidQueueArgument(interaction, true);
        await server.announceToStudentsInQueue(member, announcement, queueChannel);
    } else {
        await server.announceToStudentsInQueue(member, announcement);
    }
    return SuccessMessages.announced(announcement);
}

/**
 * Then `/clean_up` command
 * @param interaction
 * @returns
 */
async function cleanup(interaction: ChatInputCommandInteraction): Promise<string> {
    const [server, queue] = [
        isServerInteraction(interaction),
        hasValidQueueArgument(interaction, true),
        await isTriggeredByUserWithRoles(interaction, 'cleanup', ['Bot Admin'])
    ];
    await server.cleanUpQueue(queue);
    return `Queue ${queue.queueName} has been cleaned up.`;
}

/**
 * The `/cleanup_all` command
 * @param interaction
 * @returns
 */
async function cleanupAllQueues(
    interaction: ChatInputCommandInteraction
): Promise<string> {
    const [server] = [
        isServerInteraction(interaction),
        await isTriggeredByUserWithRoles(interaction, 'cleanup', ['Bot Admin'])
    ];
    const allQueues = await server.getQueueChannels();
    await Promise.all(
        allQueues.map(queueChannel => server.cleanUpQueue(queueChannel)) ?? []
    );
    return `All queues have been cleaned up.`;
}

/**
 * The `/cleanup_help_channel` command
 * @param interaction
 * @returns
 */
async function cleanupHelpChannel(
    interaction: ChatInputCommandInteraction
): Promise<string> {
    const [server] = [
        isServerInteraction(interaction),
        await isTriggeredByUserWithRoles(interaction, 'cleanup_help_channel', [
            'Bot Admin'
        ])
    ];
    await server.updateCommandHelpChannels();
    return `Successfully cleaned up everything under 'Bot Commands Help'.`;
}

/**
 * The `/set_after_session_msg` command
 * @param interaction
 * @returns
 */
async function showAfterSessionMessageModal(
    interaction: ChatInputCommandInteraction
): Promise<undefined> {
    const [server] = [
        isServerInteraction(interaction),
        await isTriggeredByUserWithRoles(interaction, 'set_after_session_msg', [
            'Bot Admin'
        ])
    ];
    await interaction.showModal(afterSessionMessageModal(server.guild.id));
    return undefined;
}

/**
 * The `/help` command
 * @param interaction
 * @returns
 */
async function help(interaction: ChatInputCommandInteraction): Promise<undefined> {
    const commandName = interaction.options.getString('command', true);
    const helpMessage =
        adminCommandHelpMessages.find(
            message => message.nameValuePair.name === commandName
        ) ??
        helperCommandHelpMessages.find(
            message => message.nameValuePair.name === commandName
        ) ??
        studentCommandHelpMessages.find(
            message => message.nameValuePair.name === commandName
        );
    if (helpMessage !== undefined) {
        await interaction.editReply(helpMessage?.message);
    } else {
        throw new CommandParseError('Command not found.');
    }
    return undefined;
}

/**
 * The `/set_logging_channel` command
 * @param interaction
 * @returns
 */
async function setLoggingChannel(
    interaction: ChatInputCommandInteraction
): Promise<string> {
    const [server] = [
        isServerInteraction(interaction),
        await isTriggeredByUserWithRoles(interaction, 'set_logging_channel', [
            'Bot Admin'
        ])
    ];
    const loggingChannel = interaction.options.getChannel('channel', true) as TextChannel;
    if (loggingChannel.type !== ChannelType.GuildText) {
        throw new CommandParseError(`${loggingChannel.name} is not a text channel.`);
    }
    await server.setLoggingChannel(loggingChannel);
    return SuccessMessages.updatedLoggingChannel(loggingChannel.name);
}

/**
 * The `/set_queue_auto_clear` command
 * @param interaction
 * @returns
 */
async function showQueueAutoClearModal(
    interaction: ChatInputCommandInteraction
): Promise<undefined> {
    const [server] = [
        isServerInteraction(interaction),
        await isTriggeredByUserWithRoles(interaction, 'set_queue_auto_clear', [
            'Bot Admin'
        ])
    ];
    await interaction.showModal(queueAutoClearModal(server.guild.id));
    return undefined;
}

/**
 * The `/stop_logging` command
 * @param interaction
 * @returns
 */
async function stopLogging(interaction: ChatInputCommandInteraction): Promise<string> {
    const [server] = [
        isServerInteraction(interaction),
        await isTriggeredByUserWithRoles(interaction, 'stop_logging', ['Bot Admin'])
    ];
    await server.setLoggingChannel(undefined);
    return SuccessMessages.stoppedLogging;
}

/**
 * The `/serious_mode` command
 * @param interaction
 * @returns
 */
async function setSeriousMode(interaction: ChatInputCommandInteraction): Promise<string> {
    const [server] = [
        isServerInteraction(interaction),
        await isTriggeredByUserWithRoles(interaction, 'activate_serious_mode', [
            'Bot Admin'
        ])
    ];
    const enable = interaction.options.getBoolean('enable', true);
    await server.setSeriousServer(enable);
    if (enable) {
        return `Successfully activated serious mode.`;
    } else {
        return `Successfully deactivated serious mode.`;
    }
}

/**
 * Only export the handler and the 'canHandle' check
 */
export { processBuiltInCommand, builtInCommandHandlerCanHandle };
