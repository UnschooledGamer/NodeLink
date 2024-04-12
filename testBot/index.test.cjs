const { Client, GatewayDispatchEvents, AttachmentBuilder, codeBlock } = require("discord.js")
const { inspect } = require(`util`);

/**
 * @type {Client<boolean> & { riffy: Riffy }}
 */

const client = new Client({
    intents: [
        "Guilds",
        "GuildMessages",
        "GuildVoiceStates",
        "MessageContent",
    ],
});


client.on("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (!message.content.startsWith("!") || message.author.bot) return;

    const args = message.content.slice(1).trim().split(" ");
    const command = args.shift().toLowerCase();

    if (command === "eval" && args[0]) {
        try {
            let evaled = await eval(args.join(" "));
            let string = inspect(evaled);

            if (string.includes(client.token))
                return message.reply("No token grabbing.");

            if (string.length > 2000) {
                let output = new AttachmentBuilder(Buffer.from(string), {
                    name: "result.js",
                });
                return message.channel.send({ files: [output] });
            }

            message.channel.send(`\`\`\`js\n${string}\n\`\`\``);
        } catch (error) {
            message.reply(`\`\`\`js\n${error}\n\`\`\``);
        }
    }

    if (command === "connect" || command === "c") {

        if (!message.member.voice.channelId) return message.reply({ content: `Join an Voice Channel And retry` });

        if (message.guild.members.me.voice.channelId) return message.reply({
            content: `I'm Already Joined(in ${message.guild.members.me.voice.channel.url}), Use \`!disconnect\` to disconnect.`
        });

        if(!message.guild.available) await message.guild.fetch();

        message.guild.shard.send({
            "op": 4,
            "d": {
              "guild_id": message.guildId,
              "channel_id": message.member.voice.channelId,
              "self_mute": false,
              "self_deaf": true
            }
        })

        await message.reply(`Joining ${message.member.voice.channel.url}`)
    }

    if(command === "disconnect" || command === "dc") {
        if (!message.member.voice.channelId) return message.reply({ content: `Join an Voice Channel And retry` });

        if (!message.guild.members.me.voice.channelId) return message.reply({
            content: `I'm not connected to any Voice Channel, Use \`!connect\` to connect.`
        });

        if(!message.guild.available) await message.guild.fetch();

        message.guild.shard.send({
            "op": 4,
            "d": {
              "guild_id": message.guildId,
              "channel_id": null,
              "self_mute": false,
              "self_deaf": true
            }
        })

        await message.reply(`Leaving ${message.member.voice.channel.url}`)
    }
});

process.on("uncaughtException", (err, origin) =>
    console.log(`[UNCAUGHT ERRORS Reporting - Exception] >> origin: ${origin} | Error: ${err.stack ?? err}`)
);
process.on("unhandledRejection", (err, _) =>
    console.log(`[unhandled ERRORS Reporting - Rejection] >> ${err.stack}, Promise: ignored/not included`)
);

let vcCache = {}

client.on("raw", (d) => {
    if (
        ![
            GatewayDispatchEvents.VoiceStateUpdate,
            GatewayDispatchEvents.VoiceServerUpdate,
        ].includes(d.t) || (GatewayDispatchEvents.VoiceStateUpdate === d.t && d.d.user_id !== client.user.id))
        return;

    console.log(`[CLIENT - RAW] :: EVENT: ${d.t} :: Data`, d.d)

    if (d.t === GatewayDispatchEvents.VoiceStateUpdate) {
        return vcCache[d.d.guild_id] = {
            sessionId: d.d.session_id
        }
    }

    vcCache[d.d.guild_id]["token"] = d.d.token
    vcCache[d.d.guild_id]["endpoint"] = d.d.endpoint

    if (vcCache[d.d.guild_id]) {
        return client.channels.cache.get("1028285720500121620").send({
            content: `${codeBlock(JSON.stringify(vcCache[d.d.guild_id]))}`
        })
    }



});

client.login("DISCORD_TOKEN");