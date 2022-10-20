/** @module SessionCalendar */

import { SlashCommandBuilder } from '@discordjs/builders';
import { ChannelType } from 'discord.js';

const setCalendar = new SlashCommandBuilder()
    .setName('set_calendar')
    .setDescription(
        'Commands to modify the resources connected to the /when_next command'
    )
    .addStringOption(option =>
        option
            .setName('calendar_id')
            .setDescription('The link to the calendar')
            .setRequired(true)
    );

const unsetCalendar = new SlashCommandBuilder()
    .setName('unset_calendar')
    .setDescription(
        'Desyncs the bot from the current calendar and sets it to the default calendar'
    );

const whenNext = new SlashCommandBuilder()
    .setName('when_next')
    .setDescription('View the upcoming tutoring hours')
    .addChannelOption(option =>
        option
            .setName('queue_name')
            .setDescription(
                'The course for which you want to view the next tutoring hours'
            )
            .setRequired(false)
            .addChannelTypes(ChannelType.GuildCategory)
    );

function makeCalendarStringCommand(): Omit<
    SlashCommandBuilder,
    'addSubcommand' | 'addSubcommandGroup'
> {
    const command = new SlashCommandBuilder()
        .setName('make_calendar_string')
        .setDescription('Generates a valid calendar string that can be parsed by YABOB')
        .addStringOption(option =>
            option
                .setName('calendar_name')
                .setDescription('Your display name on the calendar')
                .setRequired(true)
        );

    Array(20)
        .fill(undefined)
        .forEach(
            (_, idx) =>
                command.addChannelOption(option =>
                    option
                        .setName(`queue_name_${idx + 1}`)
                        .setDescription('The courses you tutor for')
                        .setRequired(idx === 0)
                        .addChannelTypes(ChannelType.GuildCategory)
                ) // make the first one required
        );

    command.addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to modify the calendar string for')
            .setRequired(false)
    );
    return command;
}

const makeCalendarStringAll = new SlashCommandBuilder()
    .setName('make_calendar_string_all')
    .setDescription('Generates a valid calendar string for all your approved queues')
    .addStringOption(option =>
        option
            .setName('calendar_name')
            .setDescription('Your display name on the calendar')
            .setRequired(true)
    )
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to modify the calendar string for')
            .setRequired(false)
    );

const setPublicEmbedUrl = new SlashCommandBuilder()
    .setName('set_public_embd_url')
    .setDescription('Use another public calendar embed')
    .addStringOption(option =>
        option
            .setName('url')
            .setDescription('The full URL to the public calendar embed')
            .setRequired(true)
    )
    .addBooleanOption(option =>
        option
            .setName('enable')
            .setDescription(
                'Whether to switch to this new public url. ' +
                    'If false, the value in `url` will be ignored'
            )
            .setRequired(true)
    );

const calendarCommands = [
    setCalendar.toJSON(),
    unsetCalendar.toJSON(),
    whenNext.toJSON(),
    makeCalendarStringCommand().toJSON(),
    makeCalendarStringAll.toJSON(),
    setPublicEmbedUrl.toJSON()
];

export { calendarCommands };
