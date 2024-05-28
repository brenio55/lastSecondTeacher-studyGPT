import express from 'express';
import { PDFDocument, rgb } from 'pdf-lib';
import { OpenAI } from 'openai';
// import cors from 'cors';
import fetch from 'node-fetch';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Carregar variáveis de ambiente
dotenv.config({ path: './../.env' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const whitelist = ['*'];

const app = express();

import cors from 'cors';

app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));

app.use(express.json());

app.use((req, res, next) => {
    const origin = req.get('referer');
    const isWhitelisted = whitelist.find((w) => origin && origin.includes(w));
    if (isWhitelisted) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,Content-Type,Authorization');
        res.setHeader('Access-Control-Allow-Credentials', true);
    }
    if (req.method === 'OPTIONS') res.sendStatus(200);
    else next();
});

const apiKey = process.env.VITE_LastSecondTeacherAPIKEY;
console.log(apiKey);
if (!apiKey) {
    console.error("API key not found. Please make sure to set the VITE_LastSecondTeacherAPIKEY environment variable.");
    process.exit(1);
}

const openAI = new OpenAI({ apiKey });

const threads = {};

app.get('/api/requireResponseOpenAI', async (req, res) => {
    console.log("Received request");
    try {
        res.status(200).json({ message: "GET Request successfully made to root API" });
    } catch (error) {
        res.status(500).json({ message: error });
    }
});

app.get('/api/requireResponseOpenAI/clearThread', async (req, res) => {
    console.log("Received request");
    res.status(200).json({ message: "GET Request successfully made to ClearThread API" });
});

app.get('/api/requireResponseOpenAI/generatePDF', async (req, res) => {
    console.log("Received request");
    res.status(200).json({ message: "GET Request successfully made to generatePDF API" });
});

app.post('/api/requireResponseOpenAI', async (req, res) => {
    const { inputText, threadId, role } = req.body;
    console.log('Received request:', { inputText, threadId, role });

    try {
        const messages = threads[threadId] || [
            { "role": "system", "content": `You are interacting with a user who is a ${role}. Your role is to assist them. If they ask about generating a worksheet, tell them to press the 'Generate PDF' button to create the worksheet.` }
        ];
        console.log('Current thread messages:', messages);

        messages.push({ "role": "user", "content": inputText });
        console.log('Updated thread messages:', messages);

        const response = await openAI.chat.completions.create({
            model: "gpt-4",
            max_tokens: 1000,
            temperature: 1,
            messages: messages
        });

        const systemMessage = response.choices[0].message;
        console.log('System response:', systemMessage);

        if (!threads[threadId]) {
            threads[threadId] = [
                { "role": "system", "content": `You are interacting with a user who is a ${role}. Your role is to assist them. If they ask about generating a worksheet, or just mention a worksheet topic, tell them to press the 'Generate PDF' button to create the worksheet.` }
            ];
        }
        threads[threadId].push(systemMessage);

        res.json({ message: systemMessage.content });
    } catch (error) {
        console.error("Error:", error.message);
        res.status(500).send({ error: error.message });
    }
});

app.post('/api/requireResponseOpenAI/clearThread', (req, res) => {
    const { threadId } = req.body;
    console.log('Clearing thread:', threadId);

    if (threads[threadId]) {
        delete threads[threadId];
        console.log('Thread cleared successfully:', threadId);
        res.json({ message: "Thread cleared successfully" });
    } else {
        console.error('Thread not found:', threadId);
        res.status(202).send({ error: "Thread not found" });
    }
});

app.post('/api/requireResponseOpenAI/generatePDF', async (req, res) => {
    const { threadId, role } = req.body;
    console.log('Generating PDF for thread:', threadId);

    try {
        const messages = threads[threadId];
        if (!messages) {
            throw new Error("Thread not found");
        }
        console.log('Messages to be included in PDF:', messages);

        const conversationHistory = messages.map(msg => `${msg.role === 'user' ? 'User' : 'System'}: ${msg.content}`).join('\n');

        const response = await openAI.chat.completions.create({
            model: "gpt-4",
            max_tokens: 1000,
            temperature: 1,
            messages: [
                { role: "system", content: "You are an AI that generates detailed worksheets based on user inquiries. Create a comprehensive worksheet including explanations, questions, and exercises based on the following conversation history:" },
                { role: "user", content: conversationHistory }
            ]
        });

        const worksheetContent = response.choices[0].message.content;
        console.log('Generated worksheet content:', worksheetContent);

        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);

        let page = pdfDoc.addPage();
        const { width, height } = page.getSize();
        const fontSize = 12;

        const fontPath = path.resolve(__dirname, '../public/Ubuntu-Regular.ttf');
        const fontBytes = fs.readFileSync(fontPath);
        const ubuntuFont = await pdfDoc.embedFont(fontBytes);

        page.setFont(ubuntuFont);
        page.setFontSize(fontSize);

        const textWidth = width - 100;
        const textHeight = height - 100;

        const wrapText = (text, maxWidth, font, fontSize) => {
            const words = text.split(' ');
            let lines = [];
            let currentLine = words[0];

            for (let i = 1; i < words.length; i++) {
                const word = words[i];
                const width = ubuntuFont.widthOfTextAtSize(`${currentLine} ${word}`, fontSize);
                if (width < maxWidth) {
                    currentLine += ` ${word}`;
                } else {
                    lines.push(currentLine);
                    currentLine = word;
                }
            }
            lines.push(currentLine);
            return lines;
        };

        const paragraphs = worksheetContent.split('\n').map(paragraph => wrapText(paragraph, textWidth, ubuntuFont, fontSize)).flat();

        let y = textHeight;

        if (role === 'teacher') {
            const explanationResponse = await openAI.chat.completions.create({
                model: "gpt-4",
                max_tokens: 500,
                temperature: 1,
                messages: [
                    { role: "system", content: "Provide an explanation of the main purpose of this activity and the correct answers." },
                    { role: "user", content: worksheetContent }
                ]
            });

            const explanation = explanationResponse.choices[0].message.content;
            console.log('Generated explanation for teacher:', explanation);

            const explanationParagraphs = explanation.split('\n').map(paragraph => wrapText(paragraph, textWidth, ubuntuFont, fontSize)).flat();
            for (const paragraph of explanationParagraphs) {
                if (y - fontSize < 0) {
                    page = pdfDoc.addPage();
                    y = textHeight;
                }
                page.drawText(paragraph, {
                    x: 50,
                    y,
                    size: fontSize,
                    font: ubuntuFont,
                    color: rgb(0, 0, 0),
                });
                y -= fontSize + 5;
            }

            y -= 20;
        }

        for (const paragraph of paragraphs) {
            if (y - fontSize < 0) {
                page = pdfDoc.addPage();
                y = textHeight;
            }
            page.drawText(paragraph, {
                x: 50,
                y,
                size: fontSize,
                font: ubuntuFont,
                color: rgb(0, 0, 0),
            });
            y -= fontSize + 5;
        }

        if (role === 'student') {
            y = textHeight - 50;
            const answersResponse = await openAI.chat.completions.create({
                model: "gpt-4",
                max_tokens: 500,
                temperature: 1,
                messages: [
                    { role: "system", content: "Provide the correct answers for the following worksheet content." },
                    { role: "user", content: worksheetContent }
                ]
            });

            const answers = answersResponse.choices[0].message.content;
            console.log('Generated answers for student:', answers);

            const answersParagraphs = answers.split('\n').map(paragraph => wrapText(paragraph, textWidth, ubuntuFont, fontSize)).flat();
            for (const paragraph of answersParagraphs) {
                if (y - fontSize < 0) {
                    page = pdfDoc.addPage();
                    y = textHeight;
                }
                page.drawText(paragraph, {
                    x: 50,
                    y,
                    size: fontSize,
                    font: ubuntuFont,
                    color: rgb(0.5, 0.5, 0.5),
                });
                y -= fontSize + 5;
            }
        }

        page.drawText('Generated by Last Second Teacher - visit lastsecondteacher.com', {
            x: 50,
            y: 20,
            size: 10,
            font: ubuntuFont,
            color: rgb(0, 0, 0),
        });

        const pdfBytes = await pdfDoc.save();

        res.setHeader('Content-Disposition', 'attachment; filename=worksheet.pdf');
        res.setHeader('Content-Type', 'application/pdf');
        res.send(Buffer.from(pdfBytes));

        console.log("PDF generated successfully");
    } catch (error) {
        console.error("Error generating PDF:", error.message);
        res.status(500).send({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

export default app;
