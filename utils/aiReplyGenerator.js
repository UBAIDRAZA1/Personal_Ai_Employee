const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

function sanitize(text, max = 3000) {
  if (!text) return '';
  return String(text).replace(/\r/g, '').slice(0, max);
}

async function callGroq(promptParts) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not set');
  }
  try {
    const masked = apiKey.length >= 8 ? `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}` : '***';
    console.log(`[AI] Using GROQ_API_KEY (masked): ${masked} | len=${apiKey.length}`);
  } catch {}
  if (typeof apiKey !== 'string' || apiKey.trim().length < 20) {
    throw new Error('GROQ_API_KEY appears invalid (length too short). Please verify .env');
  }

  return new Promise((resolve, reject) => {
    const url = new URL(GROQ_ENDPOINT);

    const body = {
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'user',
          content: promptParts.join('\n'),
        },
      ],
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 512,
    };

    const postData = JSON.stringify(body);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${apiKey}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            let msg = `Groq API error ${res.statusCode}: ${data}`;
            if (String(data).includes('Invalid API key')) {
              msg = 'Groq API key not valid. Check GROQ_API_KEY in .env and restart watchers.';
            }
            reject(new Error(msg));
            return;
          }

          const json = JSON.parse(data);
          const text = json?.choices?.[0]?.message?.content;

          if (!text || !text.trim()) {
            reject(new Error('Groq returned empty response'));
            return;
          }

          resolve(text.trim());
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

function ruleBasedFallback(toName, body, keyword) {
  // ALWAYS reply in English only
  const lower = (body || '').toLowerCase();
  const mentionsLastMonth = lower.includes('last month') || lower.includes('previous month') || lower.includes('pichla mahina') || lower.includes('monthly report');

  // Check for call requests FIRST (highest priority - user wants immediate call)
  if (lower.includes('call me') || lower.includes('call now') || lower.includes('please call') || lower.includes('urgent call')) {
    return [`Hi ${toName || ''}`.trim() + ',', '', 'Noted. We are calling you now.', 'If you prefer a specific time, please share and we will align.', 'If a different number is preferred, please share the best contact.'].join('\n');
  }

  // Check for report requests (must have 'report' keyword)
  if (lower.includes('report')) {
    if (mentionsLastMonth) {
      return [`Hi ${toName || ''}`.trim() + ',', '', 'Thanks. We will prepare last month\'s report immediately.', 'Please confirm preferred format (PDF/Excel/Summary).', 'If you need KPIs or specific sections included, let us know and we will add them.'].join('\n');
    } else {
      return [`Hi ${toName || ''}`.trim() + ',', '', 'Thank you for your message.', 'We will prepare the report right away.', 'Please confirm the date range and any specific sections to include.'].join('\n');
    }
  }

  // Check for quotation requests
  if (lower.includes('quotation') || lower.includes('quote') || lower.includes('send quotation')) {
    return [`Hi ${toName || ''}`.trim() + ',', '', 'Thank you for your message. We will share the quotation on priority.', 'To prepare an accurate quote, please confirm:', '- Items/services required', '- Quantity', '- Required delivery date', '- Specifications or notes', '- Billing details (company name, GST/VAT if applicable)', '', 'Once received, we will send the formal quotation right away.'].join('\n');
  }

  // Check for invoice/payment requests
  if (lower.includes('invoice') || lower.includes('payment')) {
    return [`Hi ${toName || ''}`.trim() + ',', '', 'Please share the invoice number or items and billing details so we can proceed immediately.'].join('\n');
  }

  // Important message send requests
  if ((lower.includes('important') || lower.includes('impoertant') || lower.includes('zaroori') || lower.includes('ahm')) && lower.includes('send')) {
    return [`Hi ${toName || ''}`.trim() + ',', '', 'Sure. Which message/file do you need? If it\'s a report, quotation, or a specific document, please name it.', 'If you need last month\'s report, please confirm and we will send it immediately.'].join('\n');
  }

  // Check for urgent/important messages (after call check)
  if ((keyword || '').toLowerCase().includes('urgent') || lower.includes('urgent') || lower.includes('asap') || lower.includes('critical') || lower.includes('important')) {
    return [`Hi ${toName || ''}`.trim() + ',', '', 'Noted. We will prioritize this.', 'Please share brief details so we can act immediately.'].join('\n');
  }

  // Default reply - ALWAYS in English
  return [`Hi ${toName || ''}`.trim() + ',', '', 'Thank you for your message.', 'Please share brief details and we will proceed.'].join('\n');
}

async function generateReply({ contactName, messageBody, keyword, handbookText, businessGoalsText, pastContext }) {
  const toName = contactName || 'there';
  const body = sanitize(messageBody, 2000);
  const handbook = sanitize(handbookText, 4000);
  const goals = sanitize(businessGoalsText, 2000);
  const past = sanitize(pastContext, 2000);

  // Always reply in English only
  const prompt = [
    'You are a professional customer support assistant for a company.',
    'Your task is to draft WhatsApp replies that are helpful, professional, and context-aware.',
    '',
    'GUIDELINES:',
    '- Be concise and professional (2-4 short paragraphs max)',
    '- Use the client name naturally in greeting',
    '- Address their specific request directly',
    '- If they need a report, confirm you will send it and ask for specifics',
    '- If they want a call, confirm you are calling and ask for preferred time/number',
    '- If urgent, acknowledge urgency and ask for brief details',
    '- Always end with a clear next step or question',
    '- IMPORTANT: ALWAYS reply in ENGLISH only, regardless of the incoming message language',
    '- Keep tone polite and clear; avoid long paragraphs',
    '',
    `Client Name: ${toName}`,
    `Incoming Message: ${body}`,
    keyword ? `Context: ${keyword}` : '',
    '',
    'Return ONLY the reply text. No explanations. No metadata.',
  ].filter(Boolean);

  console.log(`[AI] Generating reply for "${toName}" with keyword "${keyword}"...`);

  try {
    const reply = await callGroq(prompt);
    console.log(`[AI] Reply generated successfully for "${toName}"`);
    return reply;
  } catch (err) {
    console.log(`[AI] Groq failed for "${toName}": ${err.message}. Using fallback.`);
    console.log(`[AI] Message body: "${body.substring(0, 100)}..."`);
    return ruleBasedFallback(toName, body, keyword);
  }
}

module.exports = { generateReply };
