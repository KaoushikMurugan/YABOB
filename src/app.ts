// Library Imports
import {
    Client,
    Guild,
    Intents,
} from "discord.js";

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Local Imports
import dotenv from "dotenv";
import fbs_creds from "../fbs_service_account_key.json";

import { AttendingServerV2 } from "./attending-server/base-attending-server";
import { CentralCommandDispatcher } from "./command-handling/centeral-handler";
import { postSlashCommands } from "./command-handling/slash-commands";
import { ButtonCommandDispatcher } from "./command-handling/button-handler";

// Extensions
import { AttendanceExtension } from './extensions/attendance-extension';
import { CalendarExtension } from "./extensions/calendar-extension";

dotenv.config();
console.log(`Environment: ${process.env.NODE_ENV}`);

if (process.env.YABOB_BOT_TOKEN === undefined ||
    process.env.YABOB_APP_ID === undefined
) {
    throw new Error("Missing token or id. Aborting setup.");
}

const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MEMBERS,
        Intents.FLAGS.GUILD_INVITES,
        Intents.FLAGS.GUILD_VOICE_STATES,
        Intents.FLAGS.GUILD_PRESENCES,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.DIRECT_MESSAGES,
    ],
});

const serversV2: Map<string, AttendingServerV2> = new Map();

initializeApp({
    credential: cert(fbs_creds)
});

const firebase_db: FirebaseFirestore.Firestore = getFirestore();
console.log("Connected to Firebase database");

client.login(process.env.YABOB_BOT_TOKEN).catch((err: Error) => {
    console.error("Login Unsuccessful. Check YABOBs credentials.");
    throw err;
});

client.on("error", error => {
    console.error(error);
});

client.on("ready", async () => {
    const titleString = "YABOB: Yet-Another-Better-OH-Bot V4";
    console.log(
        `\x1b[30m\x1b[45m${' '.repeat((process.stdout.columns - titleString.length) / 2)}` +
        `${titleString}` +
        `${' '.repeat((process.stdout.columns - titleString.length) / 2)}\x1b[0m`
    );
    if (client.user === null) {
        throw new Error(
            "Login Unsuccessful. Check YABOB's Discord Credentials"
        );
    }
    console.log(`Logged in as ${client.user.tag}!`);
    console.log("Scanning servers I am a part of...");

    // allGuilds is all the servers this YABOB instance has joined
    const allGuilds = await Promise
        .all((await client.guilds.fetch()).map(guild => guild.fetch()));
    console.log(`Found ${allGuilds.length} server${allGuilds.length === 1 ? '' : 's'}:`);
    console.log(allGuilds.map(g => g.name));

    // launch all startup sequences in parallel
    await Promise.all(
        allGuilds.map(guild => joinGuild(guild)
            .catch((err: Error) =>
                console.error(
                    `An error occured during startup of server: `
                    + `${guild.name}.\n${err.stack}`
                ))));

    console.log("✅ \x1b[32mReady to go!\x1b[0m ✅\n");
    console.log("---- Begin Server Logs ----");
    return;
});

client.on("guildCreate", async guild => {
    console.log(`Got invited to '${guild.name}'!`);
    await joinGuild(guild);
});

client.on("interactionCreate", async interaction => {
    const commandHandler = new CentralCommandDispatcher(serversV2);
    const buttonHandler = new ButtonCommandDispatcher(serversV2);
    if (interaction.isCommand()) {
        await commandHandler.process(interaction);
    }
    if (interaction.isButton()) {
        await buttonHandler.process(interaction);
    }
});

client.on("guildMemberAdd", async member => {
    const server = serversV2.get(member.guild.id) ?? await joinGuild(member.guild);
    const studentRole = server.guild.roles.cache.find(role => role.name === 'Student');
    if (studentRole !== undefined) {
        await member.roles.add(studentRole);
    }
});

process.on('exit', () => {
    // When something fatal happens
    console.log(
        '---- End of Server Log ----\n'
        + '---- Begin Error Stack Trace ----\n');
});

/**
 * Initilization sequence
 * @param guild server tp join
 * @returns AttendingServerV2 if successfully initialized
 */
async function joinGuild(guild: Guild): Promise<AttendingServerV2> {
    if (client.user === null) {
        throw Error('Please wait until YABOB has logged in '
            + 'to manage the server');
    }
    console.log(`Joining guild ${guild.name}`);

    // Load extensions here
    // If extensions don't depend on each other, user Promise.all for faster load time
    // - Otherwise use individual awaits
    const attendanceExtension = await AttendanceExtension.load(guild.name);
    const calendarExtension = await CalendarExtension.load();

    // process.exit(0);
    const server = await AttendingServerV2.create(
        client.user,
        guild,
        firebase_db,
        [attendanceExtension],
        [calendarExtension]
    );

    await postSlashCommands(guild);
    serversV2.set(guild.id, server);
    return server;
}
