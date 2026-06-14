const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, SlashCommandBuilder, REST, Routes } = require('discord.js');
const ms = require('ms');
const express = require('express');
const fs = require('fs');

const app = express();
app.get('/', (req, res) => res.send('🦇 Batman Bot is alive!'));
app.listen(3000, () => console.log('✅ Web server running'));

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ] 
});

// ===== CONFIGURATION - ALL FROM ENVIRONMENT VARIABLES =====
const CONFIG = {
    token: process.env.TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    premiumRoleId: process.env.PREMIUM_ROLE_ID,
    supportRoleId: process.env.SUPPORT_ROLE_ID,
    ticketCategoryId: process.env.TICKET_CATEGORY_ID,
    premiumTicketCategoryId: process.env.PREMIUM_TICKET_CATEGORY_ID,
    ownerRoleId: process.env.OWNER_ROLE_ID,  // Single owner role from env
    ticketChannelId: process.env.TICKET_CHANNEL_ID  // Channel where /setup-ticket creates the panel
};

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`🦇 Batman bot is ready to go!`);
    
    const commands = [
        new SlashCommandBuilder()
            .setName('ticket')
            .setDescription('🎫 Create a ticket panel'),
        new SlashCommandBuilder()
            .setName('premium')
            .setDescription('🦇 Give someone premium (Owners only)')
            .addUserOption(opt => opt.setName('user').setRequired(true).setDescription('The user to give premium to'))
            .addStringOption(opt => opt.setName('length').setRequired(true).setDescription('1 day, 1 week, 1 month'))
            .addStringOption(opt => opt.setName('reason').setRequired(false).setDescription('Why are you giving premium?')),
        new SlashCommandBuilder()
            .setName('removepremium')
            .setDescription('🦇 Remove premium from someone (Owners only)')
            .addUserOption(opt => opt.setName('user').setRequired(true).setDescription('The user to remove premium from')),
        new SlashCommandBuilder()
            .setName('close')
            .setDescription('🔒 Close this ticket'),
        new SlashCommandBuilder()
            .setName('setup-ticket')
            .setDescription('📋 Setup the ticket system (Admin only)')
    ];
    
    const rest = new REST().setToken(CONFIG.token);
    try {
        await rest.put(Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.guildId), { body: commands });
        console.log('✅ Commands registered');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
    
    setInterval(checkExpiredPremium, 60000);
});

// Check if someone is an owner
function isOwner(member) {
    return member.roles.cache.has(CONFIG.ownerRoleId);
}

// Check if someone has premium
function hasPremium(member) {
    return member.roles.cache.has(CONFIG.premiumRoleId);
}

// Check expired premium
async function checkExpiredPremium() {
    const dataFile = './premium_data.json';
    if (!fs.existsSync(dataFile)) return;
    
    const data = JSON.parse(fs.readFileSync(dataFile));
    const now = Date.now();
    const premiumRole = await client.guilds.cache.get(CONFIG.guildId)?.roles.fetch(CONFIG.premiumRoleId);
    
    for (const [userId, expireDate] of Object.entries(data)) {
        if (now >= expireDate) {
            const member = await client.guilds.cache.get(CONFIG.guildId)?.members.fetch(userId).catch(() => null);
            if (member && premiumRole && member.roles.cache.has(CONFIG.premiumRoleId)) {
                await member.roles.remove(premiumRole);
                console.log(`⏰ Premium expired for ${member.user.tag}`);
                
                try {
                    const embed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('🦇 Premium Expired')
                        .setDescription(`Hey ${member.user.username}, your Batman premium just ran out.\n\nWant to renew? Just ask an owner!`)
                        .setFooter({ text: 'Batman Trading' });
                    await member.send({ embeds: [embed] });
                } catch(e) {}
            }
            delete data[userId];
            fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
        }
    }
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    // ===== SETUP TICKET SYSTEM (Posts in the configured channel) =====
    if (interaction.commandName === 'setup-ticket') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ This is for admins only!', ephemeral: true });
        }
        
        const targetChannel = client.channels.cache.get(CONFIG.ticketChannelId);
        if (!targetChannel) {
            return interaction.reply({ 
                content: '❌ Ticket channel not found! Check your TICKET_CHANNEL_ID in environment variables.', 
                ephemeral: true 
            });
        }
        
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🦇 BATMAN SUPPORT')
            .setDescription('Hey there! Need help? Just click a button below and we\'ll get back to you as soon as we can.')
            .addFields(
                { name: '📩 Regular Ticket', value: 'For general questions and help', inline: true },
                { name: '👑 Premium Ticket', value: 'For our premium members', inline: true },
                { name: '⏰ Response Time', value: 'We try to reply within 10-15 minutes!', inline: true }
            )
            .setFooter({ text: 'Batman Trading • We\'re here to help!' })
            .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('open_ticket')
                    .setLabel('📩 Open a Ticket')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('premium_ticket')
                    .setLabel('👑 Premium Ticket')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('faq')
                    .setLabel('❓ FAQ')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        await targetChannel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ 
            content: `✅ Ticket panel created in ${targetChannel}!`, 
            ephemeral: true 
        });
    }
    
    // ===== PREMIUM COMMAND (OWNERS ONLY) =====
    if (interaction.commandName === 'premium') {
        // Check if user has the owner role
        if (!isOwner(interaction.member)) {
            return interaction.reply({ 
                content: '❌ Sorry, only server owners can give out premium. Talk to an owner if you need it!', 
                ephemeral: true 
            });
        }
        
        const targetUser = interaction.options.getUser('user');
        const length = interaction.options.getString('length');
        const reason = interaction.options.getString('reason') || 'No reason given';
        const duration = ms(length);
        
        if (!duration) {
            return interaction.reply({ 
                content: '❌ Hmm, that doesn\'t look right. Try something like: `1 day`, `2 weeks`, or `1 month`', 
                ephemeral: true 
            });
        }
        
        const member = await interaction.guild.members.fetch(targetUser.id);
        const premiumRole = interaction.guild.roles.cache.get(CONFIG.premiumRoleId);
        
        if (!premiumRole) {
            return interaction.reply({ 
                content: '❌ Uh oh! The premium role isn\'t set up yet. Check your config!', 
                ephemeral: true 
            });
        }
        
        // Check if they already have premium
        if (member.roles.cache.has(CONFIG.premiumRoleId)) {
            return interaction.reply({ 
                content: `❌ ${targetUser.username} already has premium! Use /removepremium first if you want to change it.`, 
                ephemeral: true 
            });
        }
        
        await member.roles.add(premiumRole);
        
        const expireDate = Date.now() + duration;
        let premiumData = {};
        if (fs.existsSync('./premium_data.json')) {
            premiumData = JSON.parse(fs.readFileSync('./premium_data.json'));
        }
        premiumData[targetUser.id] = expireDate;
        fs.writeFileSync('./premium_data.json', JSON.stringify(premiumData, null, 2));
        
        // Pretty embed for the channel
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🦇 Premium Granted! 🦇')
            .setDescription(`**${targetUser.username}** just got premium!`)
            .addFields(
                { name: '📅 Duration', value: length, inline: true },
                { name: '⏰ Expires', value: `<t:${Math.floor(expireDate / 1000)}:F>`, inline: true },
                { name: '📝 Reason', value: reason, inline: false },
                { name: '👮 Given by', value: interaction.user.tag, inline: true }
            )
            .setFooter({ text: 'Batman Trading' })
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        
        // DM the user
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor(0xFFD700)
                .setTitle('🦇 You got Premium!')
                .setDescription(`Hey ${targetUser.username}! You just received premium in the Batman Trading server.`)
                .addFields(
                    { name: 'How long?', value: length, inline: true },
                    { name: 'Expires', value: `<t:${Math.floor(expireDate / 1000)}:F>`, inline: true },
                    { name: 'What now?', value: 'You can now use the premium ticket button for faster support!', inline: false }
                )
                .setFooter({ text: 'Thanks for being part of Batman Trading!' });
            await targetUser.send({ embeds: [dmEmbed] });
        } catch(e) {
            console.log('Could not DM user');
        }
    }
    
    // ===== REMOVE PREMIUM COMMAND (OWNERS ONLY) =====
    if (interaction.commandName === 'removepremium') {
        if (!isOwner(interaction.member)) {
            return interaction.reply({ 
                content: '❌ Sorry, only server owners can remove premium.', 
                ephemeral: true 
            });
        }
        
        const targetUser = interaction.options.getUser('user');
        const member = await interaction.guild.members.fetch(targetUser.id);
        const premiumRole = interaction.guild.roles.cache.get(CONFIG.premiumRoleId);
        
        if (!member.roles.cache.has(CONFIG.premiumRoleId)) {
            return interaction.reply({ 
                content: `❌ ${targetUser.username} doesn't have premium right now.`, 
                ephemeral: true 
            });
        }
        
        await member.roles.remove(premiumRole);
        
        // Remove from expiry data
        if (fs.existsSync('./premium_data.json')) {
            let premiumData = JSON.parse(fs.readFileSync('./premium_data.json'));
            delete premiumData[targetUser.id];
            fs.writeFileSync('./premium_data.json', JSON.stringify(premiumData, null, 2));
        }
        
        const embed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('🦇 Premium Removed')
            .setDescription(`${targetUser.username} no longer has premium.`)
            .addFields(
                { name: 'Removed by', value: interaction.user.tag, inline: true },
                { name: 'Removed on', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setFooter({ text: 'Batman Trading' });
        
        await interaction.reply({ embeds: [embed] });
        
        try {
            await targetUser.send(`🦇 Hey ${targetUser.username}, your Batman premium has been removed. Talk to an owner if you have questions!`);
        } catch(e) {}
    }
    
    // ===== TICKET PANEL COMMAND (Legacy - still works) =====
    if (interaction.commandName === 'ticket') {
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🎫 Open a Ticket')
            .setDescription('Click a button below to get help!')
            .addFields(
                { name: 'Regular Ticket', value: 'For everyone', inline: true },
                { name: 'Premium Ticket', value: 'Only for premium members', inline: true }
            );
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('open_ticket').setLabel('📩 Regular Ticket').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('premium_ticket').setLabel('👑 Premium Ticket').setStyle(ButtonStyle.Success)
            );
        
        await interaction.reply({ embeds: [embed], components: [row] });
    }
    
    // ===== CLOSE COMMAND =====
    if (interaction.commandName === 'close') {
        if (!interaction.channel.name.startsWith('ticket-') && !interaction.channel.name.startsWith('premium-')) {
            return interaction.reply({ 
                content: '❌ This command only works in ticket channels!', 
                ephemeral: true 
            });
        }
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🔒 Closing Ticket')
            .setDescription('This ticket will close in **5 seconds**.\n\nThanks for reaching out!');
        
        await interaction.reply({ embeds: [embed] });
        setTimeout(() => interaction.channel.delete(), 5000);
    }
});

// ===== BUTTON HANDLERS =====
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    
    // Regular ticket
    if (interaction.customId === 'open_ticket') {
        const hasPremiumRole = hasPremium(interaction.member);
        const categoryId = hasPremiumRole ? CONFIG.premiumTicketCategoryId : CONFIG.ticketCategoryId;
        const prefix = hasPremiumRole ? 'premium' : 'ticket';
        
        // Check for existing ticket
        const existingTicket = interaction.guild.channels.cache.find(
            channel => channel.name === `${prefix}-${interaction.user.username}` && channel.parentId === categoryId
        );
        
        if (existingTicket) {
            return interaction.reply({ 
                content: `❌ You already have a ticket open! Check ${existingTicket}`, 
                ephemeral: true 
            });
        }
        
        // Create the ticket
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
        
        const embed = new EmbedBuilder()
            .setColor(hasPremiumRole ? 0xFFD700 : 0x00AAFF)
            .setTitle(hasPremiumRole ? '👑 Premium Support' : '🦇 Support Ticket')
            .setDescription(`Hey ${interaction.user}! Thanks for reaching out.\n\nA staff member will be with you shortly. In the meantime, feel free to explain what you need help with!`)
            .addFields(
                { name: '📌 Ticket', value: `Created for ${interaction.user.tag}`, inline: true },
                { name: '💡 Tip', value: 'Use **/close** when we\'re done!', inline: true }
            )
            .setFooter({ text: 'Batman Trading • We got your back!' })
            .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Close Ticket')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('📋 Claim Ticket')
                    .setStyle(ButtonStyle.Success)
            );
        
        await ticketChannel.send({ 
            content: `<@${interaction.user.id}> <@&${CONFIG.supportRoleId}>`, 
            embeds: [embed], 
            components: [row] 
        });
        
        await interaction.reply({ 
            content: `✅ Ticket created! Head over to ${ticketChannel}`, 
            ephemeral: true 
        });
    }
    
    // Premium ticket button
    if (interaction.customId === 'premium_ticket') {
        if (!hasPremium(interaction.member)) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Premium Only')
                .setDescription('This button is only for premium members!\n\nWant premium? Talk to an owner about getting it.')
                .setFooter({ text: 'Batman Trading' });
            
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
        
        // Check for existing premium ticket
        const existingTicket = interaction.guild.channels.cache.find(
            channel => channel.name === `premium-${interaction.user.username}` && channel.parentId === CONFIG.premiumTicketCategoryId
        );
        
        if (existingTicket) {
            return interaction.reply({ 
                content: `❌ You already have a premium ticket open! Check ${existingTicket}`, 
                ephemeral: true 
            });
        }
        
        // Create premium ticket
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
        
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('👑 Premium Support Ticket')
            .setDescription(`Hey ${interaction.user}! Thanks for being a premium member.\n\nWe'll get back to you as soon as we can. Premium members usually get a faster response!`)
            .addFields(
                { name: '📌 Premium Member', value: interaction.user.tag, inline: true },
                { name: '💡 Note', value: 'Just explain your issue and we\'ll help you out!', inline: true }
            )
            .setFooter({ text: 'Batman Trading • Thanks for supporting us!' })
            .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Close Ticket')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('📋 Claim Ticket')
                    .setStyle(ButtonStyle.Success)
            );
        
        await ticketChannel.send({ 
            content: `<@${interaction.user.id}> <@&${CONFIG.supportRoleId}> 👑 **PREMIUM TICKET** 👑`, 
            embeds: [embed], 
            components: [row] 
        });
        
        await interaction.reply({ 
            content: `✅ Premium ticket created! Go to ${ticketChannel}`, 
            ephemeral: true 
        });
    }
    
    // Close button
    if (interaction.customId === 'close_ticket') {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🔒 Close this ticket?')
            .setDescription('Click **Confirm** to close this ticket.\nClick **Cancel** to keep it open.')
            .setFooter({ text: 'Batman Trading' });
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_close')
                    .setLabel('✅ Confirm')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('cancel_close')
                    .setLabel('❌ Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
    
    // Confirm close
    if (interaction.customId === 'confirm_close') {
        await interaction.reply({ content: '🔒 Closing in 5 seconds...', ephemeral: true });
        setTimeout(() => interaction.channel.delete(), 5000);
    }
    
    // Cancel close
    if (interaction.customId === 'cancel_close') {
        await interaction.update({ content: '❌ Close cancelled!', embeds: [], components: [] });
    }
    
    // Claim ticket
    if (interaction.customId === 'claim_ticket') {
        if (!interaction.member.roles.cache.has(CONFIG.supportRoleId)) {
            return interaction.reply({ content: '❌ Only support team can claim tickets!', ephemeral: true });
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Ticket Claimed')
            .setDescription(`${interaction.user} is now helping you out! They'll reply as soon as they can.`)
            .setFooter({ text: 'Batman Trading' });
        
        await interaction.reply({ embeds: [embed] });
    }
    
    // FAQ button
    if (interaction.customId === 'faq') {
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('📖 Frequently Asked Questions')
            .setDescription('Here are some common questions:')
            .addFields(
                { name: '🦇 How do I get premium?', value: 'Talk to an owner! They\'re the only ones who can give it out.', inline: false },
                { name: '⏰ How long until someone replies?', value: 'We try to reply within 10-15 minutes. Premium members usually get a faster response!', inline: false },
                { name: '🔒 How do I close my ticket?', value: 'Just type `/close` in this channel, or click the close button!', inline: false },
                { name: '📝 What can I use tickets for?', value: 'Questions, reports, appeals, or just saying hi!', inline: false }
            )
            .setFooter({ text: 'Batman Trading • Got more questions? Just open a ticket!' });
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

client.login(CONFIG.token);
