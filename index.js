const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, SlashCommandBuilder, REST, Routes } = require('discord.js');
const ms = require('ms');
const express = require('express');
const fs = require('fs');

// Express voor Render
const app = express();
app.get('/', (req, res) => res.send('🦇 Batman Bot is alive!'));
app.listen(3000, () => console.log('✅ Web server online'));

// ALLE benodigde intents toevoegen
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ] 
});

// CONFIGURATIE - VUL DIT IN MET JOUW ID's
const CONFIG = {
    token: process.env.TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    premiumRoleId: process.env.PREMIUM_ROLE_ID,
    supportRoleId: process.env.SUPPORT_ROLE_ID,
    ticketCategoryId: process.env.TICKET_CATEGORY_ID,      // Normale tickets categorie
    premiumTicketCategoryId: process.env.PREMIUM_TICKET_CATEGORY_ID  // Premium tickets categorie
};

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`🦇 Batman Ticket Bot is klaar!`);
    
    // Registreer slash commands
    const commands = [
        new SlashCommandBuilder()
            .setName('ticket')
            .setDescription('🎫 Maak ticket panel aan'),
        new SlashCommandBuilder()
            .setName('premium')
            .setDescription('🦇 Geef premium (Admin only)')
            .addUserOption(opt => opt.setName('user').setRequired(true).setDescription('Gebruiker'))
            .addStringOption(opt => opt.setName('length').setRequired(true).setDescription('1 day, 1 week, 1 month'))
            .addStringOption(opt => opt.setName('reason').setRequired(false).setDescription('Reden')),
        new SlashCommandBuilder()
            .setName('close')
            .setDescription('🔒 Sluit ticket'),
        new SlashCommandBuilder()
            .setName('setup-ticket')
            .setDescription('📋 Zet ticket kanaal op (Admin only)')
    ];
    
    const rest = new REST().setToken(CONFIG.token);
    try {
        await rest.put(Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.guildId), { body: commands });
        console.log('✅ Commands geregistreerd');
    } catch (error) {
        console.error('Fout bij registreren commands:', error);
    }
    
    // Check elke minuut voor verlopen premium
    setInterval(checkExpired, 60000);
});

// Check verlopen premium
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
            fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
            console.log(`⏰ Premium verwijderd van ${member?.user?.tag || userId}`);
        }
    }
}

// Check of gebruiker premium heeft
function hasPremium(member) {
    return member.roles.cache.has(CONFIG.premiumRoleId);
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    // === SETUP TICKET KANAAL (Admin only) ===
    if (interaction.commandName === 'setup-ticket') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Alleen admins!', ephemeral: true });
        }
        
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🦇 BATMAN SUPPORT TICKETS 🦇')
            .setDescription('Welkom bij het Batman Trading support systeem!\n\n**Hoe werkt het?**\n• Klik op de knop hieronder om een ticket te openen\n• Normale tickets gaan naar de normale categorie\n• **Premium leden** krijgen toegang tot **premium support** 🦇\n• Gebruik **/close** om het ticket te sluiten\n\n**Premium voordelen:**\n• Snellere response tijd\n• Prioriteit support\n• Eigen premium ticket categorie')
            .addFields(
                { name: '⏰ Normale response tijd', value: 'Binnen 30 minuten', inline: true },
                { name: '⚡ Premium response tijd', value: 'Binnen 5 minuten', inline: true },
                { name: '🦇 Support team', value: `<@&${CONFIG.supportRoleId}>`, inline: true }
            )
            .setFooter({ text: 'Batman Trading • Support Systeem' })
            .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('open_ticket')
                    .setLabel('📩 Open Ticket')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🎫'),
                new ButtonBuilder()
                    .setCustomId('premium_ticket')
                    .setLabel('👑 Premium Ticket')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🦇'),
                new ButtonBuilder()
                    .setCustomId('faq')
                    .setLabel('❓ FAQ')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📖')
            );
        
        await interaction.reply({ embeds: [embed], components: [row] });
    }
    
    // === PREMIUM COMMAND ===
    if (interaction.commandName === 'premium') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Alleen admins kunnen dit commando gebruiken!', ephemeral: true });
        }
        
        const user = interaction.options.getUser('user');
        const length = interaction.options.getString('length');
        const reason = interaction.options.getString('reason') || 'Geen reden opgegeven';
        const duration = ms(length);
        
        if (!duration) {
            return interaction.reply({ 
                content: '❌ Ongeldige duur! Gebruik bijv: `1 day`, `2 weeks`, `1 month`', 
                ephemeral: true 
            });
        }
        
        const member = await interaction.guild.members.fetch(user.id);
        const role = interaction.guild.roles.cache.get(CONFIG.premiumRoleId);
        
        if (!role) {
            return interaction.reply({ content: '❌ Premium rol niet gevonden! Check je configuratie.', ephemeral: true });
        }
        
        await member.roles.add(role);
        
        // Opslaan voor expire
        const expireDate = Date.now() + duration;
        let data = {};
        if (fs.existsSync('./premium_data.json')) data = JSON.parse(fs.readFileSync('./premium_data.json'));
        data[user.id] = expireDate;
        fs.writeFileSync('./premium_data.json', JSON.stringify(data, null, 2));
        
        // Embed met Batman logo
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🦇 BATMAN PREMIUM 🦇')
            .setDescription(`**${user.tag}** heeft nu premium ontvangen!`)
            .addFields(
                { name: '📅 Duur', value: `\`${length}\``, inline: true },
                { name: '⏰ Verloopt op', value: `<t:${Math.floor(expireDate/1000)}:F>`, inline: true },
                { name: '⏱️ Nog te gaan', value: `<t:${Math.floor(expireDate/1000)}:R>`, inline: true },
                { name: '📝 Reden', value: reason, inline: false },
                { name: '👮 Toegekend door', value: interaction.user.tag, inline: true }
            )
            .setFooter({ text: 'Batman Trading • Premium Service' })
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        
        // Stuur DM naar gebruiker
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor(0xFFD700)
                .setTitle('🦇 Batman Premium')
                .setDescription(`Je hebt **${length}** premium gekregen in de Batman Trading server!`)
                .addFields(
                    { name: 'Verloopt op', value: `<t:${Math.floor(expireDate/1000)}:F>`, inline: true },
                    { name: 'Premium voordeel', value: 'Je krijgt nu prioriteit support!', inline: true }
                )
                .setFooter({ text: 'Batman Trading' });
            await user.send({ embeds: [dmEmbed] });
        } catch(e) {
            console.log('Kon geen DM sturen');
        }
    }
    
    // === TICKET PANEL COMMAND (oude manier, werkt ook) ===
    if (interaction.commandName === 'ticket') {
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🎫 BATMAN SUPPORT')
            .setDescription('Klik op een knop om een ticket te openen')
            .addFields(
                { name: '📩 Normaal Ticket', value: 'Voor algemene support', inline: true },
                { name: '👑 Premium Ticket', value: 'Alleen voor premium leden', inline: true }
            );
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('open_ticket').setLabel('📩 Normaal Ticket').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('premium_ticket').setLabel('👑 Premium Ticket').setStyle(ButtonStyle.Success)
            );
        
        await interaction.reply({ embeds: [embed], components: [row] });
    }
    
    // === CLOSE COMMAND ===
    if (interaction.commandName === 'close') {
        if (!interaction.channel.name.startsWith('ticket-') && !interaction.channel.name.startsWith('premium-')) {
            return interaction.reply({ content: '❌ Dit commando kan alleen in een ticket kanaal gebruikt worden!', ephemeral: true });
        }
        
        const closeEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🔒 Ticket wordt gesloten')
            .setDescription('Dit ticket wordt over **5 seconden** gesloten.\nBedankt voor het gebruiken van Batman Support!')
            .setFooter({ text: 'Batman Trading' });
        
        await interaction.reply({ embeds: [closeEmbed] });
        setTimeout(() => interaction.channel.delete(), 5000);
    }
});

// Knop interacties
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    
    // Normaal ticket openen
    if (interaction.customId === 'open_ticket') {
        const hasPremiumRole = hasPremium(interaction.member);
        const categoryId = hasPremiumRole ? CONFIG.premiumTicketCategoryId : CONFIG.ticketCategoryId;
        const prefix = hasPremiumRole ? 'premium' : 'ticket';
        
        // Check of gebruiker al een open ticket heeft
        const existingTicket = interaction.guild.channels.cache.find(
            channel => channel.name === `${prefix}-${interaction.user.username}` && channel.parentId === categoryId
        );
        
        if (existingTicket) {
            return interaction.reply({ 
                content: `❌ Je hebt al een open ticket! Ga naar ${existingTicket}`, 
                ephemeral: true 
            });
        }
        
        // Maak ticket aan
        const ticketChannel = await interaction.guild.channels.create({
            name: `${prefix}-${interaction.user.username}`,
            type: ChannelType.GuildText,
            parent: categoryId,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] },
                { id: CONFIG.supportRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages] }
            ]
        });
        
        // Embed voor in het ticket
        const ticketEmbed = new EmbedBuilder()
            .setColor(hasPremiumRole ? 0xFFD700 : 0x00FF00)
            .setTitle(hasPremiumRole ? '👑 BATMAN PREMIUM SUPPORT 👑' : '🦇 BATMAN SUPPORT TICKET 🦇')
            .setDescription(`Welkom ${interaction.user},\n\nEen support medewerker zal je zo snel mogelijk helpen!`)
            .addFields(
                { name: '📌 Ticket Type', value: hasPremiumRole ? 'Premium Support' : 'Normale Support', inline: true },
                { name: '👤 Aangemaakt door', value: interaction.user.tag, inline: true },
                { name: '📅 Datum', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
                { name: '⚡ Response tijd', value: hasPremiumRole ? 'Binnen 5 minuten' : 'Binnen 30 minuten', inline: true },
                { name: '💡 Instructies', value: '• Leg je vraag uit\n• Wees geduldig\n• Gebruik **/close** om te sluiten', inline: false }
            )
            .setFooter({ text: 'Batman Trading • Support', iconURL: 'https://i.imgur.com/YourBatmanImage.png' })
            .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Sluit Ticket')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒'),
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('📋 Claim Ticket')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );
        
        await ticketChannel.send({ 
            content: `<@${interaction.user.id}> <@&${CONFIG.supportRoleId}>`, 
            embeds: [ticketEmbed], 
            components: [row] 
        });
        
        await interaction.reply({ 
            content: `✅ ${hasPremiumRole ? 'Premium' : ''} Ticket succesvol aangemaakt! Ga naar ${ticketChannel}`, 
            ephemeral: true 
        });
    }
    
    // Premium ticket knop (alleen voor premium leden)
    if (interaction.customId === 'premium_ticket') {
        if (!hasPremium(interaction.member)) {
            const noPremiumEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Geen Premium Access')
                .setDescription('Deze knop is alleen voor premium leden!\n\nKoop premium via een admin om toegang te krijgen tot:\n• Snellere support\n• Prioriteit behandeling\n• Eigen premium categorie')
                .setFooter({ text: 'Batman Trading' });
            
            return interaction.reply({ embeds: [noPremiumEmbed], ephemeral: true });
        }
        
        // Check of gebruiker al een premium ticket heeft
        const existingTicket = interaction.guild.channels.cache.find(
            channel => channel.name === `premium-${interaction.user.username}` && channel.parentId === CONFIG.premiumTicketCategoryId
        );
        
        if (existingTicket) {
            return interaction.reply({ 
                content: `❌ Je hebt al een premium ticket! Ga naar ${existingTicket}`, 
                ephemeral: true 
            });
        }
        
        // Maak premium ticket aan
        const ticketChannel = await interaction.guild.channels.create({
            name: `premium-${interaction.user.username}`,
            type: ChannelType.GuildText,
            parent: CONFIG.premiumTicketCategoryId,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] },
                { id: CONFIG.supportRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages] }
            ]
        });
        
        const premiumEmbed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('👑 BATMAN PREMIUM SUPPORT 👑')
            .setDescription(`Welkom ${interaction.user} bij de premium support!\n\nJe krijgt **prioriteit behandeling** door ons team.`)
            .addFields(
                { name: '⚡ Premium Service', value: 'Response tijd: **Binnen 5 minuten**', inline: true },
                { name: '👤 Aangemaakt door', value: interaction.user.tag, inline: true },
                { name: '🦇 Speciale behandeling', value: 'Je staat vooraan in de wachtrij!', inline: true }
            )
            .setFooter({ text: 'Batman Trading • Premium Support' })
            .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Sluit Ticket')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒'),
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('📋 Claim Ticket')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );
        
        await ticketChannel.send({ 
            content: `<@${interaction.user.id}> <@&${CONFIG.supportRoleId}> **⚡ PREMIUM TICKET - PRIORITEIT ⚡**`, 
            embeds: [premiumEmbed], 
            components: [row] 
        });
        
        await interaction.reply({ 
            content: `✅ Premium ticket aangemaakt! Ga naar ${ticketChannel}`, 
            ephemeral: true 
        });
    }
    
    // Sluit ticket knop
    if (interaction.customId === 'close_ticket') {
        const closeEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🔒 Ticket Sluiten')
            .setDescription('Weet je zeker dat je dit ticket wilt sluiten?\nKlik op **Bevestig** om te sluiten.')
            .setFooter({ text: 'Batman Trading' });
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_close')
                    .setLabel('✅ Bevestig')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('cancel_close')
                    .setLabel('❌ Annuleer')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        await interaction.reply({ embeds: [closeEmbed], components: [row], ephemeral: true });
    }
    
    // Bevestig sluiten
    if (interaction.customId === 'confirm_close') {
        await interaction.reply({ content: '🔒 Ticket wordt over 5 seconden gesloten...', ephemeral: true });
        setTimeout(() => interaction.channel.delete(), 5000);
    }
    
    // Annuleer sluiten
    if (interaction.customId === 'cancel_close') {
        await interaction.update({ content: '❌ Sluiten geannuleerd!', embeds: [], components: [] });
    }
    
    // Claim ticket
    if (interaction.customId === 'claim_ticket') {
        if (!interaction.member.roles.cache.has(CONFIG.supportRoleId)) {
            return interaction.reply({ content: '❌ Alleen support team kan tickets claimen!', ephemeral: true });
        }
        
        const claimEmbed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Ticket Geclaimed')
            .setDescription(`${interaction.user} heeft dit ticket geclaimed en zal je helpen!`)
            .setFooter({ text: 'Batman Trading' });
        
        await interaction.reply({ embeds: [claimEmbed] });
    }
    
    // FAQ knop
    if (interaction.customId === 'faq') {
        const faqEmbed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('📖 Veelgestelde Vragen')
            .setDescription('Hier zijn de meest gestelde vragen:')
            .addFields(
                { name: '🦇 Hoe krijg ik premium?', value: 'Neem contact op met een admin via een ticket!', inline: false },
                { name: '⚡ Wat zijn premium voordelen?', value: 'Snellere support (binnen 5 min) en prioriteit behandeling!', inline: false },
                { name: '❓ Hoe lang duurt normale support?', value: 'Meestal binnen 30 minuten.', inline: false },
                { name: '🔒 Hoe sluit ik mijn ticket?', value: 'Gebruik **/close** in het ticket kanaal.', inline: false }
            )
            .setFooter({ text: 'Batman Trading' });
        
        await interaction.reply({ embeds: [faqEmbed], ephemeral: true });
    }
});

client.login(CONFIG.token);
