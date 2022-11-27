/** @module BuiltInHandlers */

import { ModalSubmitInteraction } from 'discord.js';
import {
    afterSessionMessageConfigMenu,
    queueAutoClearConfigMenu
} from '../attending-server/server-settings-menus.js';
import { modalFactory } from '../utils/component-id-factory.js';
import { ErrorEmbed, ErrorLogEmbed } from '../utils/embed-helper.js';
import {
    DMModalSubmitCallback,
    ModalSubmitCallback,
    YabobEmbed
} from '../utils/type-aliases.js';
import { logModalSubmit } from '../utils/util-functions.js';
import { SuccessMessages } from './builtin-success-messages.js';
import { isServerInteraction } from './common-validations.js';
import { ExpectedParseErrors } from './expected-interaction-errors.js';

/**
 * Built in handler for modal submit
 * @category Handler Class
 */

/**
 * Map of names of modal that could be sent in servers to their respective handlers
 */
const modalMethodMap: { [modalName: string]: ModalSubmitCallback } = {
    after_session_message_modal: interaction =>
        setAfterSessionMessage(interaction, false),
    after_session_message_modal_mv: interaction =>
        setAfterSessionMessage(interaction, true),
    queue_auto_clear_modal: interaction => setQueueAutoClear(interaction, false),
    queue_auto_clear_modal_mv: interaction => setQueueAutoClear(interaction, true)
} as const;

/**
 * Map of names of modal that could be sent in dms to their respective handlers
 */
const dmModalMethodMap: { [modalName: string]: DMModalSubmitCallback } = {
    // no modals in dms implemented yet
} as const;

/**
 * List of modal names that should update the parent interaction
 */
const updateParentInteractionModals = [
    'after_session_message_modal_mv',
    'queue_auto_clear_modal_mv'
];

/**
 * Check if the modal interaction can be handled by this (in-built) handler
 * @remark This is for modals that are prompted in servers
 * @param interaction
 * @returns
 */
function builtInModalHandlerCanHandle(
    interaction: ModalSubmitInteraction<'cached'>
): boolean {
    const modalName = modalFactory.decompressComponentId(interaction.customId)[1];
    return modalName in modalMethodMap;
}

/**
 * Check if the modal interaction can be handled by this (in-built) handler
 * @remark This is for modals that are prompted in dms
 * @param interaction
 * @returns
 */
function builtInDMModalHandlerCanHandle(interaction: ModalSubmitInteraction): boolean {
    const modalName = modalFactory.decompressComponentId(interaction.customId)[1];
    return modalName in dmModalMethodMap;
}

/**
 * Handles all built in modal submit interactions
 * - Calls the appropriate handler based on the modal name
 * - Logs the interaction
 * - Sends the appropriate response
 * @remark This is for modals that are prompted in servers.
 * For the version that handles modals in dms, see {@link processBuiltInDMModalSubmit}
 * @param interaction
 */
async function processBuiltInModalSubmit(
    interaction: ModalSubmitInteraction<'cached'>
): Promise<void> {
    const modalName = modalFactory.decompressComponentId(interaction.customId)[1];
    const modalMethod = modalMethodMap[modalName];
    logModalSubmit(interaction, modalName);
    // if process is called then modalMethod is definitely not null
    // this is checked in app.ts with `modalHandler.canHandle`
    await modalMethod?.(interaction)
        .then(async successMsg => {
            await (updateParentInteractionModals.includes(modalName) &&
            interaction.isFromMessage()
                ? interaction.update(successMsg)
                : interaction.reply({
                      ...successMsg,
                      ephemeral: true
                  }));
        })
        .catch(async err => {
            const server = isServerInteraction(interaction);
            await Promise.all([
                interaction.replied
                    ? interaction.editReply(ErrorEmbed(err, server.botAdminRoleID))
                    : interaction.reply({
                          ...ErrorEmbed(err, server.botAdminRoleID),
                          ephemeral: true
                      }),
                server?.sendLogMessage(ErrorLogEmbed(err, interaction))
            ]);
        });
}

/**
 * Handles all built in modal submit interactions
 * - Calls the appropriate handler based on the modal name
 * - Sends the appropriate response
 * @remark This is for modals that are prompted in dms.
 * For the version that handles modals in servers, see {@link processBuiltInModalSubmit}
 * @param interaction
 */
async function processBuiltInDMModalSubmit(
    interaction: ModalSubmitInteraction
): Promise<void> {
    const modalName = modalFactory.decompressComponentId(interaction.customId)[1];
    const modalMethod = dmModalMethodMap[modalName];
    // if process is called then modalMethod is definitely not null
    // this is checked in app.ts with `modalHandler.canHandle`
    await modalMethod?.(interaction)
        // Everything is reply here because showModal is guaranteed to be the 1st response
        // modal shown => message not replied, so we always reply
        .then(async successMsg => {
            await interaction.reply({
                ...successMsg,
                ephemeral: true
            });
        })
        .catch(async err => {
            await (interaction.replied
                ? interaction.editReply(ErrorEmbed(err))
                : interaction.reply({
                      ...ErrorEmbed(err),
                      ephemeral: true
                  }));
        });
}

/**
 * Handles the modal submission from `/set_after_session_msg`
 * @param interaction
 * @returns
 */
async function setAfterSessionMessage(
    interaction: ModalSubmitInteraction<'cached'>,
    useMenu: boolean
): Promise<YabobEmbed> {
    const server = isServerInteraction(interaction);
    const message = interaction.fields.getTextInputValue('after_session_msg');
    await server.setAfterSessionMessage(message);
    return useMenu
        ? afterSessionMessageConfigMenu(server, interaction.channelId ?? '0', false)
        : SuccessMessages.updatedAfterSessionMessage(message);
}

/**
 * Handles the modal submission from `/set_queue_auto_clear`
 * @param interaction
 * @returns
 */
async function setQueueAutoClear(
    interaction: ModalSubmitInteraction<'cached'>,
    useMenu: boolean
): Promise<YabobEmbed> {
    const server = isServerInteraction(interaction);
    const hoursInput = interaction.fields.getTextInputValue('auto_clear_hours');
    const minutesInput = interaction.fields.getTextInputValue('auto_clear_minutes');
    const hours = hoursInput === '' ? 0 : parseInt(hoursInput);
    const minutes = minutesInput === '' ? 0 : parseInt(minutesInput);
    if (isNaN(hours) || isNaN(minutes)) {
        throw ExpectedParseErrors.badAutoClearValues;
    }
    const enable = !(hours === 0 && minutes === 0);
    await server.setQueueAutoClear(hours, minutes, enable);
    return useMenu
        ? queueAutoClearConfigMenu(server, interaction.channelId ?? '0', false)
        : enable
        ? SuccessMessages.queueAutoClear.enabled(hours, minutes)
        : SuccessMessages.queueAutoClear.disabled;
}

/**
 * Only export the handler and the 'canHandle' check
 */
export {
    builtInModalHandlerCanHandle,
    builtInDMModalHandlerCanHandle,
    processBuiltInModalSubmit,
    processBuiltInDMModalSubmit
};
