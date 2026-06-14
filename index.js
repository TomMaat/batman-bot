const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, SlashCommandBuilder, REST, Routes } = require('discord.js');
const ms = require('ms');
const express = require('express');
const fs = require('fs');

// Express voor Render
const app = express();
app.get('/', (req, res) => res.send('🦇 Batman Bot is alive!'));
app.listen(3000, () => console.log('✅ Web server online'));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] });

// DIT MOET JE INVULLEN MET JOUW ID's
const CONFIG = {
    token: process.env.TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    premiumRoleId: process.env.PREMIUM_ROLE_ID,
    supportRoleId: process.env.SUPPORT_ROLE_ID,
    ticketCategoryId: process.env.TICKET_CATEGORY_ID
};

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    
    const commands = [
        new SlashCommandBuilder().setName('ticket').setDescription('🎫 Maak ticket panel'),
        new SlashCommandBuilder().setName('premium')
            .setDescription('🦇 Geef premium')
            .addUserOption(opt => opt.setName('user').setRequired(true).setDescription('Gebruiker'))
            .addStringOption(opt => opt.setName('length').setRequired(true).setDescription('1 day, 1 week, 1 month')),
        new SlashCommandBuilder().setName('close').setDescription('🔒 Sluit ticket')
    ];
    
    const rest = new REST().setToken(CONFIG.token);
    await rest.put(Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.guildId), { body: commands });
    console.log('✅ Commands geregistreerd');
    
    setInterval(checkExpired, 60000);
});

async function checkExpired() {
    const dataFile = './premium_data.json';
    if (!fs.existsSync(dataFile)) return;
    const data = JSON.parse(fs.readFileSync(dataFile));
    const now = Date.now();
    const role = await client.guilds.cache.get(CONFIG.guildId)?.roles.fetch(CONFIG.premiumRoleId);
    
    for (const [userId, expire] of Object.entries(data)) {
        if (now >= expire) {
            const member = await client.guilds.cache.get(CONFIG.guildId)?.members.fetch(userId).catch(() => null);
            if (member && role) await member.roles.remove(role);
            delete data[userId];
            fs.writeFileSync(dataFile, JSON.stringify(data));
        }
    }
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    if (interaction.commandName === 'premium') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Alleen admins!', ephemeral: true });
        }
        
        const user = interaction.options.getUser('user');
        const length = interaction.options.getString('length');
        const duration = ms(length);
        
        if (!duration) {
            return interaction.reply({ content: '❌ Gebruik: 1 day, 2 weeks, 1 month', ephemeral: true });
        }
        
        const member = await interaction.guild.members.fetch(user.id);
        const role = interaction.guild.roles.cache.get(CONFIG.premiumRoleId);
        if (!role) return interaction.reply({ content: '❌ Premium rol niet gevonden!', ephemeral: true });
        
        await member.roles.add(role);
        
        const expireDate = Date.now() + duration;
        let data = {};
        if (fs.existsSync('./premium_data.json')) data = JSON.parse(fs.readFileSync('./premium_data.json'));
        data[user.id] = expireDate;
        fs.writeFileSync('./premium_data.json', JSON.stringify(data, null, 2));
        
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🦇 BATMAN PREMIUM 🦇')
            .setDescription(`${user.tag} heeft nu premium!`)
            .addFields(
                { name: '📅 Duur', value: length, inline: true },
                { name: '⏰ Verloopt', value: `<t:${Math.floor(expireDate/1000)}:R>`, inline: true }
            );
        
        await interaction.reply({ embeds: [embed] });
        await user.send(`🦇 Je hebt ${length} premium gekregen!`).catch(() => {});
    }
    
    if (interaction.commandName === 'ticket') {
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🎫 BATMAN SUPPORT')
            .setDescription('Klik op de knop om een ticket te openen');
        
        const row = new ActionRowBuilder()
            .addComponents(new ButtonBuilder().setCustomId('open_ticket').setLabel('📩 Open Ticket').setStyle(ButtonStyle.Primary));
        
        await interaction.reply({ embeds: [embed], components: [row] });
    }
    
    if (interaction.commandName === 'close') {
        if (!interaction.channel.name.startsWith('ticket-')) {
            return interaction.reply({ content: '❌ Dit is geen ticket!', ephemeral: true });
        }
        await interaction.reply('🔒 Ticket sluit over 5 seconden...');
        setTimeout(() => interaction.channel.delete(), 5000);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    
    if (interaction.customId === 'open_ticket') {
        const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: ChannelType.GuildText,
            parent: CONFIG.ticketCategoryId,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: CONFIG.supportRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });
        
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🦇 Batman Support')
            .setDescription(`Welkom ${interaction.user}! Gebruik **/close** om te sluiten.`);
        
        await ticketChannel.send({ content: `<@${interaction.user.id}> <@&${CONFIG.supportRoleId}>`, embeds: [embed] });
        await interaction.reply({ content: `✅ Ticket gemaakt: ${ticketChannel}`, ephemeral: true });
    }
});

client.login(CONFIG.token);