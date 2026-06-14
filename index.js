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

// ===== CONFIGURATION - FROM ENVIRONMENT VARIABLES =====
const CONFIG = {
    token: process.env.TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    premiumRoleId: process.env.PREMIUM_ROLE_ID,
    supportRoleId: process.env.SUPPORT_ROLE_ID,
    ownerRoleId: process.env.OWNER_ROLE_ID,
    ticketChannelId: process.env.TICKET_CHANNEL_ID,
    logsChannelId: process.env.LOGS_CHANNEL_ID,  // New: Channel for logs
    // Category IDs
    generalCategoryId: process.env.GENERAL_CATEGORY_ID,
    premiumCategoryId: process.env.PREMIUM_CATEGORY_ID,
    mentorshipCategoryId: process.env.MENTORSHIP_CATEGORY_ID
};

// Premium data file
const PREMIUM_DATA_FILE = './premium_data.json';

// Load premium data
function loadPremiumData() {
    if (!fs.existsSync(PREMIUM_DATA_FILE)) {
        return {};
    }
    return JSON.parse(fs.readFileSync(PREMIUM_DATA_FILE));
}

// Save premium data
function savePremiumData(data) {
    fs.writeFileSync(PREMIUM_DATA_FILE, JSON.stringify(data, null, 2));
}

// Send log to logs channel
async function sendLog(embed) {
    const logsChannel = client.channels.cache.get(CONFIG.logsChannelId);
    if (!logsChannel) {
        console.log('❌ Logs channel not found! Check LOGS_CHANNEL_ID');
        return;
    }
    await logsChannel.send({ embeds: [embed] }).catch(console.error);
}

// Get transcript of a channel
async function getTranscript(channel) {
    let messages = [];
    try {
        const fetched = await channel.messages.fetch({ limit: 100 });
        messages = fetched.reverse();
    } catch(e) {
        return 'Could not fetch messages';
    }
    
    let transcript = `=== TICKET TRANSCRIPT ===\n`;
    transcript += `Channel: ${channel.name}\n`;
    transcript += `Created: ${new Date(channel.createdAt).toLocaleString()}\n`;
    transcript += `========================\n\n`;
    
    for (const msg of messages) {
        const date = new Date(msg.createdAt).toLocaleString();
        const attachments = msg.attachments.size > 0 ? ` [${msg.attachments.size} attachments]` : '';
        transcript += `[${date}] ${msg.author.tag}: ${msg.content || '(No text)'}${attachments}\n`;
    }
    
    return transcript;
}

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`🦇 Batman bot is ready!`);
    
    const commands = [
        new SlashCommandBuilder()
            .setName('setup-ticket')
            .setDescription('📋 Setup the ticket system (Admin only)'),
        new SlashCommandBuilder()
            .setName('premium')
            .setDescription('🦇 Give premium to someone (Owners only)')
            .addUserOption(opt => opt.setName('user').setRequired(true).setDescription('User to give premium to'))
            .addStringOption(opt => opt.setName('length').setRequired(true).setDescription('1 day, 1 week, 1 month, 1 year'))
            .addStringOption(opt => opt.setName('reason').setRequired(false).setDescription('Reason for giving premium')),
        new SlashCommandBuilder()
            .setName('removepremium')
            .setDescription('🦇 Remove premium from someone (Owners only)')
            .addUserOption(opt => opt.setName('user').setRequired(true).setDescription('User to remove premium from')),
        new SlashCommandBuilder()
            .setName('checkpremium')
            .setDescription('🔍 Check when your premium expires'),
        new SlashCommandBuilder()
            .setName('close')
            .setDescription('🔒 Close this ticket'),
        new SlashCommandBuilder()
            .setName('ping')
            .setDescription('🏓 Check bot latency')
    ];
    
    const rest = new REST().setToken(CONFIG.token);
    try {
        await rest.put(Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.guildId), { body: commands });
        console.log('✅ Commands registered');
        
        // Log to channel
        const logEmbed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('🟢 Bot Online')
            .setDescription(`Bot is online and ready!`)
            .addFields(
                { name: 'Bot Name', value: client.user.tag, inline: true },
                { name: 'Commands', value: '7 commands loaded', inline: true }
            )
            .setTimestamp();
        await sendLog(logEmbed);
        
    } catch (error) {
        console.error('Error registering commands:', error);
    }
    
    // Check for expired premium every minute
    setInterval(checkExpiredPremium, 60000);
    console.log('✅ Premium expiry checker is running');
});

// Check if someone has premium
function hasPremium(member) {
    return member.roles.cache.has(CONFIG.premiumRoleId);
}

// Check and remove expired premium
async function checkExpiredPremium() {
    const premiumData = loadPremiumData();
    const now = Date.now();
    let changed = false;
    
    for (const [userId, expireDate] of Object.entries(premiumData)) {
        if (now >= expireDate) {
            const member = await client.guilds.cache.get(CONFIG.guildId)?.members.fetch(userId).catch(() => null);
            if (member) {
                const premiumRole = member.guild.roles.cache.get(CONFIG.premiumRoleId);
                if (premiumRole && member.roles.cache.has(CONFIG.premiumRoleId)) {
                    await member.roles.remove(premiumRole);
                    console.log(`⏰ Premium expired for ${member.user.tag}`);
                    
                    // Log to channel
                    const logEmbed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('⏰ Premium Expired')
                        .setDescription(`${member.user.tag} lost premium automatically`)
                        .addFields(
                            { name: 'User', value: member.user.tag, inline: true },
                            { name: 'User ID', value: member.id, inline: true },
                            { name: 'Expired on', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                        )
                        .setTimestamp();
                    await sendLog(logEmbed);
                    
                    // Send DM to user
                    try {
                        const embed = new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('🦇 Premium Expired')
                            .setDescription(`Hey ${member.user.username}, your Batman premium has expired.\n\nWant to renew? Open a ticket in <#${CONFIG.ticketChannelId}>!`)
                            .setFooter({ text: 'Batman Trading' });
                        await member.send({ embeds: [embed] });
                    } catch(e) {}
                }
            }
            delete premiumData[userId];
            changed = true;
        }
    }
    
    if (changed) {
        savePremiumData(premiumData);
        console.log('✅ Premium data updated');
    }
}

// Check if user is owner
function isOwner(member) {
    return member.roles.cache.has(CONFIG.ownerRoleId);
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    // Log command usage (except ping to avoid spam)
    if (interaction.commandName !== 'ping') {
        const commandLog = new EmbedBuilder()
            .setColor(0x00AAFF)
            .setTitle('📝 Command Used')
            .addFields(
                { name: 'Command', value: `/${interaction.commandName}`, inline: true },
                { name: 'User', value: interaction.user.tag, inline: true },
                { name: 'Channel', value: `<#${interaction.channel.id}>`, inline: true }
            )
            .setTimestamp();
        await sendLog(commandLog);
    }
    
    // ===== PING COMMAND =====
    if (interaction.commandName === 'ping') {
        const ping = client.ws.ping;
        await interaction.reply({ content: `🏓 Pong! Latency: ${ping}ms`, ephemeral: true });
    }
    
    // ===== SETUP TICKET SYSTEM =====
    if (interaction.commandName === 'setup-ticket') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        }
        
        const channel = client.channels.cache.get(CONFIG.ticketChannelId);
        if (!channel) {
            return interaction.reply({ content: '❌ Ticket channel not found!', ephemeral: true });
        }
        
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🦇 BATMAN TRADING SUPPORT')
            .setDescription('Hey there! What do you need help with? Click a button below.')
            .addFields(
                { name: '❓ General Question', value: 'Ask anything about the server or trading', inline: true },
                { name: '👑 Buy Premium', value: 'Get premium perks and benefits', inline: true },
                { name: '🎓 Mentorship', value: 'Get help from experienced traders', inline: true }
            )
            .setFooter({ text: 'We usually reply within 10-15 minutes!' })
            .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('general_ticket')
                    .setLabel('❓ General Question')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('❓'),
                new ButtonBuilder()
                    .setCustomId('buy_premium')
                    .setLabel('👑 Buy Premium')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('👑'),
                new ButtonBuilder()
                    .setCustomId('mentorship_ticket')
                    .setLabel('🎓 Mentorship')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🎓')
            );
        
        await channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `✅ Ticket panel created in ${channel}!`, ephemeral: true });
        
        // Log setup
        const setupLog = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('📋 Ticket System Setup')
            .setDescription(`Ticket panel created by ${interaction.user.tag}`)
            .addFields(
                { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                { name: 'Categories', value: 'General | Premium | Mentorship', inline: true }
            )
            .setTimestamp();
        await sendLog(setupLog);
    }
    
    // ===== CHECK PREMIUM COMMAND =====
    if (interaction.commandName === 'checkpremium') {
        const premiumData = loadPremiumData();
        const expireDate = premiumData[interaction.user.id];
        
        if (!expireDate || !hasPremium(interaction.member)) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('🦇 Premium Status')
                .setDescription('You don\'t have premium right now.')
                .addFields(
                    { name: 'Want premium?', value: `Click the "Buy Premium" button in <#${CONFIG.ticketChannelId}>!` }
                )
                .setFooter({ text: 'Batman Trading' });
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
        
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🦇 Your Premium Status')
            .addFields(
                { name: 'Status', value: '✅ Active', inline: true },
                { name: 'Expires', value: `<t:${Math.floor(expireDate / 1000)}:F>`, inline: true },
                { name: 'Time left', value: `<t:${Math.floor(expireDate / 1000)}:R>`, inline: true }
            )
            .setFooter({ text: 'Thanks for supporting Batman Trading!' });
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // ===== PREMIUM COMMAND (OWNERS ONLY) =====
    if (interaction.commandName === 'premium') {
        if (!isOwner(interaction.member)) {
            return interaction.reply({ 
                content: '❌ Only owners can give premium. Talk to an owner if you need it!', 
                ephemeral: true 
            });
        }
        
        const targetUser = interaction.options.getUser('user');
        const length = interaction.options.getString('length');
        const reason = interaction.options.getString('reason') || 'No reason given';
        const duration = ms(length);
        
        if (!duration) {
            return interaction.reply({ 
                content: '❌ Invalid duration! Use: `1 day`, `2 weeks`, `1 month`, `1 year`', 
                ephemeral: true 
            });
        }
        
        const member = await interaction.guild.members.fetch(targetUser.id);
        const premiumRole = interaction.guild.roles.cache.get(CONFIG.premiumRoleId);
        
        if (!premiumRole) {
            return interaction.reply({ content: '❌ Premium role not found!', ephemeral: true });
        }
        
        if (member.roles.cache.has(CONFIG.premiumRoleId)) {
            return interaction.reply({ 
                content: `❌ ${targetUser.username} already has premium! Use /removepremium first.`, 
                ephemeral: true 
            });
        }
        
        await member.roles.add(premiumRole);
        
        const expireDate = Date.now() + duration;
        const premiumData = loadPremiumData();
        premiumData[targetUser.id] = expireDate;
        savePremiumData(premiumData);
        
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🦇 Premium Granted!')
            .setDescription(`${targetUser.username} now has premium!`)
            .addFields(
                { name: 'Duration', value: length, inline: true },
                { name: 'Expires', value: `<t:${Math.floor(expireDate / 1000)}:F>`, inline: true },
                { name: 'Reason', value: reason, inline: false },
                { name: 'Given by', value: interaction.user.tag, inline: true }
            )
            .setFooter({ text: 'Batman Trading' });
        
        await interaction.reply({ embeds: [embed] });
        
        // Log premium grant
        const grantLog = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('👑 Premium Granted')
            .addFields(
                { name: 'User', value: targetUser.tag, inline: true },
                { name: 'Duration', value: length, inline: true },
                { name: 'Given by', value: interaction.user.tag, inline: true },
                { name: 'Expires', value: `<t:${Math.floor(expireDate / 1000)}:R>`, inline: true }
            )
            .setTimestamp();
        await sendLog(grantLog);
        
        // DM user
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor(0xFFD700)
                .setTitle('🦇 You got Premium!')
                .setDescription(`You received premium in Batman Trading server!`)
                .addFields(
                    { name: 'Duration', value: length, inline: true },
                    { name: 'Expires', value: `<t:${Math.floor(expireDate / 1000)}:F>`, inline: true }
                )
                .setFooter({ text: 'Enjoy your perks!' });
            await targetUser.send({ embeds: [dmEmbed] });
        } catch(e) {}
    }
    
    // ===== REMOVE PREMIUM COMMAND =====
    if (interaction.commandName === 'removepremium') {
        if (!isOwner(interaction.member)) {
            return interaction.reply({ content: '❌ Owners only!', ephemeral: true });
        }
        
        const targetUser = interaction.options.getUser('user');
        const member = await interaction.guild.members.fetch(targetUser.id);
        const premiumRole = interaction.guild.roles.cache.get(CONFIG.premiumRoleId);
        
        if (!member.roles.cache.has(CONFIG.premiumRoleId)) {
            return interaction.reply({ content: `❌ ${targetUser.username} doesn't have premium.`, ephemeral: true });
        }
        
        await member.roles.remove(premiumRole);
        
        const premiumData = loadPremiumData();
        delete premiumData[targetUser.id];
        savePremiumData(premiumData);
        
        const embed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('🦇 Premium Removed')
            .setDescription(`${targetUser.username} no longer has premium.`);
        
        await interaction.reply({ embeds: [embed] });
        
        // Log premium removal
        const removeLog = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('👑 Premium Removed')
            .addFields(
                { name: 'User', value: targetUser.tag, inline: true },
                { name: 'Removed by', value: interaction.user.tag, inline: true }
            )
            .setTimestamp();
        await sendLog(removeLog);
        
        try {
            await targetUser.send(`🦇 Your Batman premium has been removed. Talk to an owner if you have questions.`);
        } catch(e) {}
    }
    
    // ===== CLOSE COMMAND =====
    if (interaction.commandName === 'close') {
        if (!interaction.channel.name.startsWith('ticket-')) {
            return interaction.reply({ content: '❌ This is not a ticket channel!', ephemeral: true });
        }
        
        // Get transcript before closing
        const transcript = await getTranscript(interaction.channel);
        
        // Save transcript to file
        const transcriptFile = `./transcript-${interaction.channel.id}-${Date.now()}.txt`;
        fs.writeFileSync(transcriptFile, transcript);
        
        // Send transcript to logs channel
        const transcriptEmbed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('📝 Ticket Transcript')
            .addFields(
                { name: 'Channel', value: interaction.channel.name, inline: true },
                { name: 'Closed by', value: interaction.user.tag, inline: true },
                { name: 'Messages', value: 'Transcript attached below', inline: true }
            )
            .setTimestamp();
        
        const logsChannel = client.channels.cache.get(CONFIG.logsChannelId);
        if (logsChannel) {
            await logsChannel.send({ embeds: [transcriptEmbed], files: [transcriptFile] });
        }
        
        await interaction.reply('🔒 Closing ticket in 5 seconds...');
        
        setTimeout(() => {
            interaction.channel.delete();
            // Clean up transcript file
            fs.unlinkSync(transcriptFile);
        }, 5000);
    }
});

// ===== BUTTON HANDLERS =====
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    
    // Helper function to create ticket
    async function createTicket(categoryId, ticketType, title, color, customMessage = '') {
        // Check for existing open ticket
        const existingTicket = interaction.guild.channels.cache.find(
            channel => channel.name === `ticket-${interaction.user.username}` && channel.parentId === categoryId
        );
        
        if (existingTicket) {
            return interaction.reply({ 
                content: `❌ You already have an open ticket! Check ${existingTicket}`, 
                ephemeral: true 
            });
        }
        
        const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: ChannelType.GuildText,
            parent: categoryId,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] },
                { id: CONFIG.supportRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages] }
            ]
        });
        
        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(`Hey ${interaction.user}! ${customMessage || 'A staff member will help you shortly.'}`)
            .addFields(
                { name: '📌 Ticket Type', value: ticketType, inline: true },
                { name: '💡 Tip', value: 'Use **/close** when we\'re done!', inline: true }
            )
            .setFooter({ text: 'Batman Trading' })
            .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await ticketChannel.send({ 
            content: `<@${interaction.user.id}> <@&${CONFIG.supportRoleId}>`, 
            embeds: [embed], 
            components: [row] 
        });
        
        await interaction.reply({ 
            content: `✅ Ticket created! Go to ${ticketChannel}`, 
            ephemeral: true 
        });
        
        // Log ticket creation
        const ticketLog = new EmbedBuilder()
            .setColor(0x00AAFF)
            .setTitle('🎫 Ticket Created')
            .addFields(
                { name: 'User', value: interaction.user.tag, inline: true },
                { name: 'Type', value: ticketType, inline: true },
                { name: 'Channel', value: `<#${ticketChannel.id}>`, inline: true },
                { name: 'Category', value: `<#${categoryId}>`, inline: true }
            )
            .setTimestamp();
        await sendLog(ticketLog);
    }
    
    // ===== GENERAL QUESTION TICKET =====
    if (interaction.customId === 'general_ticket') {
        await createTicket(
            CONFIG.generalCategoryId,
            'General Question',
            '❓ General Support Ticket',
            0x00AAFF,
            'Thanks for reaching out! A staff member will help you shortly. Please explain your question.'
        );
    }
    
    // ===== BUY PREMIUM TICKET =====
    if (interaction.customId === 'buy_premium') {
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('👑 Buy Premium')
            .setDescription('Premium gives you cool perks! Check out the options below:')
            .addFields(
                { name: '💎 Premium Benefits', value: '• Premium role\n• Access to premium channels\n• Faster support\n• Exclusive giveaways', inline: false },
                { name: '💰 Prices', value: '• 1 month - $5\n• 3 months - $12\n• 6 months - $20\n• 1 year - $35', inline: false },
                { name: '📝 How to buy', value: 'Click **Continue** below and a staff member will help you with payment!', inline: false }
            )
            .setFooter({ text: 'We accept PayPal, Crypto, and Discord Gift' });
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('continue_premium')
                    .setLabel('✅ Continue to Purchase')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('cancel_buy')
                    .setLabel('❌ Cancel')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
    
    // Continue premium purchase
    if (interaction.customId === 'continue_premium') {
        // Check for existing ticket
        const existingTicket = interaction.guild.channels.cache.find(
            channel => channel.name === `ticket-${interaction.user.username}` && channel.parentId === CONFIG.premiumCategoryId
        );
        
        if (existingTicket) {
            return interaction.reply({ 
                content: `❌ You already have a ticket open! Check ${existingTicket}`, 
                ephemeral: true 
            });
        }
        
        const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: ChannelType.GuildText,
            parent: CONFIG.premiumCategoryId,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] },
                { id: CONFIG.supportRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages] }
            ]
        });
        
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('👑 Premium Purchase Request')
            .setDescription(`Hey ${interaction.user}! Thanks for your interest in premium!`)
            .addFields(
                { name: '📝 What happens now?', value: 'A staff member will DM you with payment options.', inline: false },
                { name: '💳 Available payment methods', value: '• PayPal\n• Crypto (BTC, ETH, USDC)\n• Discord Nitro Gift', inline: false },
                { name: '⏰ Response time', value: 'Usually within 5-10 minutes!', inline: true }
            )
            .setFooter({ text: 'Please be patient - we\'ll get to you soon!' })
            .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await ticketChannel.send({ 
            content: `<@${interaction.user.id}> <@&${CONFIG.supportRoleId}> 👑 **PREMIUM PURCHASE REQUEST** 👑`, 
            embeds: [embed], 
            components: [row] 
        });
        
        await interaction.reply({ 
            content: `✅ Premium purchase ticket created! Go to ${ticketChannel}`, 
            ephemeral: true 
        });
        
        // Log premium purchase request
        const purchaseLog = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('👑 Premium Purchase Request')
            .addFields(
                { name: 'User', value: interaction.user.tag, inline: true },
                { name: 'Channel', value: `<#${ticketChannel.id}>`, inline: true }
            )
            .setTimestamp();
        await sendLog(purchaseLog);
    }
    
    // Cancel purchase
    if (interaction.customId === 'cancel_buy') {
        await interaction.update({ 
            content: '❌ Purchase cancelled! Feel free to come back anytime.', 
            embeds: [], 
            components: [] 
        });
    }
    
    // ===== MENTORSHIP TICKET =====
    if (interaction.customId === 'mentorship_ticket') {
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('🎓 Mentorship Program')
            .setDescription('Our mentors can help you become a better trader!')
            .addFields(
                { name: '📚 What we offer', value: '• Trading strategies\n• Market analysis\n• Risk management\n• One-on-one coaching', inline: false },
                { name: '💰 Price', value: '$50 per month', inline: true },
                { name: '⏰ Sessions', value: '2 sessions per week', inline: true }
            )
            .setFooter({ text: 'Click Continue to start your mentorship journey!' });
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('continue_mentorship')
                    .setLabel('✅ Continue to Mentorship')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('cancel_mentorship')
                    .setLabel('❌ Cancel')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
    
    // Continue mentorship
    if (interaction.customId === 'continue_mentorship') {
        const existingTicket = interaction.guild.channels.cache.find(
            channel => channel.name === `ticket-${interaction.user.username}` && channel.parentId === CONFIG.mentorshipCategoryId
        );
        
        if (existingTicket) {
            return interaction.reply({ 
                content: `❌ You already have a ticket open! Check ${existingTicket}`, 
                ephemeral: true 
            });
        }
        
        const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: ChannelType.GuildText,
            parent: CONFIG.mentorshipCategoryId,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] },
                { id: CONFIG.supportRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages] }
            ]
        });
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('🎓 Mentorship Request')
            .setDescription(`Hey ${interaction.user}! Thanks for your interest in mentorship!`)
            .addFields(
                { name: '📝 What happens now?', value: 'A mentor will contact you shortly.', inline: false },
                { name: '📚 What to expect', value: '• Assessment of your skill level\n• Custom learning plan\n• Weekly sessions', inline: false }
            )
            .setFooter({ text: 'We\'ll match you with the best mentor for your needs!' })
            .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await ticketChannel.send({ 
            content: `<@${interaction.user.id}> <@&${CONFIG.supportRoleId}> 🎓 **MENTORSHIP REQUEST** 🎓`, 
            embeds: [embed], 
            components: [row] 
        });
        
        await interaction.reply({ 
            content: `✅ Mentorship ticket created! Go to ${ticketChannel}`, 
            ephemeral: true 
        });
        
        // Log mentorship request
        const mentorLog = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('🎓 Mentorship Request')
            .addFields(
                { name: 'User', value: interaction.user.tag, inline: true },
                { name: 'Channel', value: `<#${ticketChannel.id}>`, inline: true }
            )
            .setTimestamp();
        await sendLog(mentorLog);
    }
    
    if (interaction.customId === 'cancel_mentorship') {
        await interaction.update({ 
            content: '❌ Mentorship cancelled! Come back anytime.', 
            embeds: [], 
            components: [] 
        });
    }
    
    // Close button
    if (interaction.customId === 'close_ticket') {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🔒 Close this ticket?')
            .setDescription('Click **Confirm** to close.\nClick **Cancel** to keep open.');
        
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
    
    if (interaction.customId === 'confirm_close') {
        // Get transcript before closing
        const transcript = await getTranscript(interaction.channel);
        const transcriptFile = `./transcript-${interaction.channel.id}-${Date.now()}.txt`;
        fs.writeFileSync(transcriptFile, transcript);
        
        const transcriptEmbed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('📝 Ticket Transcript')
            .addFields(
                { name: 'Channel', value: interaction.channel.name, inline: true },
                { name: 'Closed by', value: interaction.user.tag, inline: true }
            )
            .setTimestamp();
        
        const logsChannel = client.channels.cache.get(CONFIG.logsChannelId);
        if (logsChannel) {
            await logsChannel.send({ embeds: [transcriptEmbed], files: [transcriptFile] });
        }
        
        await interaction.reply({ content: '🔒 Closing in 5 seconds...', ephemeral: true });
        setTimeout(() => {
            interaction.channel.delete();
            fs.unlinkSync(transcriptFile);
        }, 5000);
    }
    
    if (interaction.customId === 'cancel_close') {
        await interaction.update({ content: '❌ Close cancelled!', embeds: [], components: [] });
    }
});

client.login(CONFIG.token);
