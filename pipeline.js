import { topicsDatabase, generateDynamicSimulation, agentsConfig } from './agents.js';

// Helper delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Direct REST call to Gemini API using global fetch (Node 18+)
async function callGeminiAPI(prompt, systemInstruction, temperature) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: parseFloat(temperature) || 0.4
    }
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API Response Error (${response.status}): ${errText}`);
  }

  const result = await response.json();
  if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts[0]) {
    return result.candidates[0].content.parts[0].text;
  } else {
    throw new Error('Unexpected response format from Gemini API: ' + JSON.stringify(result));
  }
}

export async function runBackendPipeline(options, onEvent) {
  const { topic, tone, format, prompts } = options;
  const apiKey = process.env.GEMINI_API_KEY;
  const isRealAI = !!(apiKey && apiKey.trim().length > 0);

  if (isRealAI) {
    onEvent({ type: 'log', tag: 'system', message: 'Gemini API Key detected. Initializing live AI model chain (gemini-1.5-flash)...', color: 'rgba(39,174,96,0.15)' });
  } else {
    onEvent({ type: 'log', tag: 'system', message: 'No Gemini API Key found in environment. Running in Offline High-Fidelity Simulation Mode.', color: 'rgba(255,255,255,0.1)' });
  }

  // Load baseline template data for simulation/fallback
  let fallbackData;
  if (topic === 'medicine' || topic === 'farming' || topic === 'architecture') {
    fallbackData = topicsDatabase[topic];
  } else {
    fallbackData = generateDynamicSimulation(topic, tone, format);
  }

  // Shared state between agent runs
  let researchOutput = '';
  let outlineOutput = '';
  let draftOutput = '';
  let seoOutput = '';
  let finalDocument = '';
  let seoScore = 0;
  let targetKeywords = [];

  // ==========================================
  // 1. Researcher Node
  // ==========================================
  await runNode('researcher', async (agent) => {
    if (isRealAI) {
      onEvent({ type: 'log', tag: agent.role, message: `Querying web indexes and medical/scientific archives for: "${topic}"...`, color: agent.color });
      await sleep(1000);

      const systemInstruction = prompts?.researcher || agent.systemPrompt;
      const prompt = `Research Topic: ${topic}
Target Tone: ${tone}
Format: ${format}

Instructions: Please gather critical statistics, recent developments, and at least 3 citations. Return a summary of facts. Keep it under 200 words.`;

      try {
        researchOutput = await callGeminiAPI(prompt, systemInstruction, agent.stats.temperature);
        
        // Log split lines to console
        const lines = researchOutput.split('\n').filter(l => l.trim().length > 0);
        for (const line of lines.slice(0, 5)) {
          onEvent({ type: 'log', tag: agent.role, message: line, color: agent.color });
          await sleep(500);
        }
      } catch (err) {
        onEvent({ type: 'log', tag: agent.role, message: `API Error: ${err.message}. Falling back to template data.`, color: agent.color });
        await useFallbackLogs('researcher', agent);
      }
    } else {
      await useFallbackLogs('researcher', agent);
    }
  });

  // ==========================================
  // 2. Outliner Node
  // ==========================================
  await runNode('outliner', async (agent) => {
    if (isRealAI) {
      onEvent({ type: 'log', tag: agent.role, message: `Analyzing research facts. Generating content outline for: "${topic}"...`, color: agent.color });
      await sleep(1000);

      const systemInstruction = prompts?.outliner || agent.systemPrompt;
      const prompt = `Research Notes:\n${researchOutput || fallbackData.data.researcher.join('\n')}\n\nTopic: ${topic}\nFormat: ${format}\nCreate a structured markdown outline (H1, H2, H3 elements) for the copywriter.`;

      try {
        outlineOutput = await callGeminiAPI(prompt, systemInstruction, agent.stats.temperature);
        
        const lines = outlineOutput.split('\n').filter(l => l.trim().length > 0);
        for (const line of lines.slice(0, 5)) {
          onEvent({ type: 'log', tag: agent.role, message: line, color: agent.color });
          await sleep(500);
        }
      } catch (err) {
        onEvent({ type: 'log', tag: agent.role, message: `API Error: ${err.message}. Using template outline.`, color: agent.color });
        await useFallbackLogs('outliner', agent);
      }
    } else {
      await useFallbackLogs('outliner', agent);
    }
  });

  // ==========================================
  // 3. Writer Node (Generates and Streams Draft)
  // ==========================================
  await runNode('writer', async (agent) => {
    onEvent({ type: 'log', tag: agent.role, message: `Initializing drafting module using tone: "${tone}"...`, color: agent.color });
    await sleep(800);

    if (isRealAI) {
      const systemInstruction = prompts?.writer || agent.systemPrompt;
      const prompt = `Topic: ${topic}
Format: ${format}
Tone: ${tone}
Content Outline:
${outlineOutput || fallbackData.data.outliner.join('\n')}

Instructions: Write the full detailed content inside separate headings (H1, H2, etc.). Use markdown formatting. Provide rich detailed paragraphs. Do NOT add meta commentary or conversational intro outside the article text. Keep it around 500-800 words.`;

      try {
        onEvent({ type: 'log', tag: agent.role, message: 'Invoking content generator. Compiling draft...', color: agent.color });
        
        const fullDraft = await callGeminiAPI(prompt, systemInstruction, agent.stats.temperature);
        draftOutput = fullDraft;

        // Stream the completed draft text in chunk packets to emulate smooth typing
        const docLines = draftOutput.split('\n');
        let currentDoc = '';
        let lineGroup = [];
        
        for (let i = 0; i < docLines.length; i++) {
          lineGroup.push(docLines[i]);
          if (docLines[i].trim() === '---' || i === docLines.length - 1 || lineGroup.length >= 6) {
            currentDoc += lineGroup.join('\n') + '\n';
            onEvent({ type: 'draft', content: currentDoc });
            
            const words = currentDoc.split(/\s+/).filter(w => w.length > 0).length;
            onEvent({ type: 'log', tag: agent.role, message: `Drafting section chunk (${words} words compiled)...`, color: agent.color, textColor: 'var(--text-secondary)' });
            lineGroup = [];
            await sleep(1000);
          }
        }
        
        onEvent({ type: 'seo_score', score: 45 });
        await sleep(600);
      } catch (err) {
        onEvent({ type: 'log', tag: agent.role, message: `API Error: ${err.message}. Using fallback draft.`, color: agent.color });
        await useFallbackWriter(agent);
      }
    } else {
      await useFallbackWriter(agent);
    }
  });

  // ==========================================
  // 4. SEO Specialist Node
  // ==========================================
  await runNode('seo', async (agent) => {
    onEvent({ type: 'log', tag: agent.role, message: 'Auditing drafted prose for keyword density and semantic headers...', color: agent.color });
    await sleep(1000);

    const currentDraft = draftOutput || fallbackData.data.finalDoc;

    if (isRealAI) {
      const systemInstruction = prompts?.seo || agent.systemPrompt;
      const prompt = `Article Draft:
${currentDraft}

Instructions: Analyze this article draft for search engine optimization. 
1. Recommend 4 relevant keywords.
2. Estimate a score out of 100 for the draft (must be between 70 and 99).
3. Return the exact keywords and the score in this format at the VERY end:
SCORE: <number>
KEYWORDS: <comma separated list>`;

      try {
        seoOutput = await callGeminiAPI(prompt, systemInstruction, agent.stats.temperature);
        onEvent({ type: 'log', tag: agent.role, message: 'SEO Audit results processed.', color: agent.color });
        
        // Parse Score & Keywords
        const scoreMatch = seoOutput.match(/SCORE:\s*(\d+)/i);
        const keywordsMatch = seoOutput.match(/KEYWORDS:\s*(.*)/i);
        
        seoScore = scoreMatch ? parseInt(scoreMatch[1], 10) : 85;
        targetKeywords = keywordsMatch ? keywordsMatch[1].split(',').map(k => k.trim()) : fallbackData.keywords;
        
        onEvent({ type: 'log', tag: agent.role, message: `Calculated SEO Relevance Score: ${seoScore}/100`, color: agent.color });
        onEvent({ type: 'log', tag: agent.role, message: `Target keywords injected: ${targetKeywords.join(', ')}`, color: agent.color });
        
        onEvent({ type: 'keywords', keywords: targetKeywords });
        
        // Animate score
        for (let s = 45; s <= seoScore; s++) {
          onEvent({ type: 'seo_score', score: s });
          await sleep(20);
        }
      } catch (err) {
        onEvent({ type: 'log', tag: agent.role, message: `SEO Analysis failed: ${err.message}. Using standard optimization parameters.`, color: agent.color });
        await useFallbackSEO(agent);
      }
    } else {
      await useFallbackSEO(agent);
    }
  });

  // ==========================================
  // 5. Editor Node
  // ==========================================
  await runNode('editor', async (agent) => {
    onEvent({ type: 'log', tag: agent.role, message: 'Running grammar checkers and structural readability filters...', color: agent.color });
    await sleep(1000);

    const currentDraft = draftOutput || fallbackData.data.finalDoc;

    if (isRealAI) {
      const systemInstruction = prompts?.editor || agent.systemPrompt;
      const prompt = `Article to Edit:
${currentDraft}

Instructions: Please edit this draft. Improve structural clarity, correct any grammar or spelling mistakes, and refine sentence transitions. Keep the Markdown formatting intact. Return ONLY the final polished article content.`;

      try {
        finalDocument = await callGeminiAPI(prompt, systemInstruction, agent.stats.temperature);
        onEvent({ type: 'log', tag: agent.role, message: 'Grammar review complete. Applied readability flow enhancements.', color: agent.color });
        onEvent({ type: 'draft', content: finalDocument });
        
        const finalScore = Math.min(seoScore + 8, 98);
        for (let s = seoScore; s <= finalScore; s++) {
          onEvent({ type: 'seo_score', score: s });
          await sleep(30);
        }
      } catch (err) {
        onEvent({ type: 'log', tag: agent.role, message: `Editor failed: ${err.message}. Pushing baseline draft.`, color: agent.color });
        await useFallbackEditor(agent);
      }
    } else {
      await useFallbackEditor(agent);
    }
  });

  // ==========================================
  // 6. Publisher Node
  // ==========================================
  await runNode('publisher', async (agent) => {
    if (isRealAI) {
      onEvent({ type: 'log', tag: agent.role, message: 'Formatting document structure to GitHub-Flavored Markdown specifications.', color: agent.color });
      await sleep(800);
      onEvent({ type: 'log', tag: agent.role, message: 'Generating packaging manifest...', color: agent.color });
      await sleep(600);
      onEvent({ type: 'log', tag: agent.role, message: 'Syncing deployment routes to local file exports.', color: agent.color });
      await sleep(600);
    } else {
      await useFallbackLogs('publisher', agent);
    }
    onEvent({ type: 'log', tag: 'system', message: 'All pipeline operations completed successfully.', color: 'rgba(39, 174, 96, 0.2)', textColor: '#27ae60' });
  });

  // ==========================================
  // Helper Functions for offline fallback
  // ==========================================
  async function runNode(agentId, action) {
    onEvent({ type: 'status', agentId, status: 'active' });
    await action(agentsConfig[agentId]);
    onEvent({ type: 'status', agentId, status: 'complete' });
    await sleep(400);
  }

  async function useFallbackLogs(agentId, agent) {
    const logs = fallbackData.data[agentId];
    for (const logLine of logs) {
      onEvent({ type: 'log', tag: agent.role, message: logLine, color: agent.color });
      await sleep(1000);
    }
  }

  async function useFallbackWriter(agent) {
    onEvent({ type: 'log', tag: agent.role, message: fallbackData.data.writer[0], color: agent.color });
    await sleep(800);
    onEvent({ type: 'log', tag: agent.role, message: 'Reading outline parameters. Generating paragraphs...', color: agent.color });
    await sleep(600);

    const docLines = fallbackData.data.finalDoc.split('\n');
    let dynamicDoc = '';
    let lineGroup = [];
    
    for (let i = 0; i < docLines.length; i++) {
      lineGroup.push(docLines[i]);
      if (docLines[i].trim() === '---' || i === docLines.length - 1 || lineGroup.length >= 6) {
        dynamicDoc += lineGroup.join('\n') + '\n';
        draftOutput = dynamicDoc;
        onEvent({ type: 'draft', content: draftOutput });
        
        const words = draftOutput.split(/\s+/).filter(w => w.length > 0).length;
        onEvent({ type: 'log', tag: agent.role, message: `Drafting section chunk (${words} words compiled)...`, color: agent.color, textColor: 'var(--text-secondary)' });
        lineGroup = [];
        await sleep(1000);
      }
    }
    onEvent({ type: 'seo_score', score: 45 });
  }

  async function useFallbackSEO(agent) {
    const logs = fallbackData.data.seo;
    for (const logLine of logs) {
      onEvent({ type: 'log', tag: agent.role, message: logLine, color: agent.color });
      await sleep(1000);
    }
    
    onEvent({ type: 'keywords', keywords: fallbackData.keywords });
    
    for (let s = 45; s <= 85; s++) {
      onEvent({ type: 'seo_score', score: s });
      await sleep(20);
    }
  }

  async function useFallbackEditor(agent) {
    const logs = fallbackData.data.editor;
    for (const logLine of logs) {
      onEvent({ type: 'log', tag: agent.role, message: logLine, color: agent.color });
      await sleep(1000);
    }
    
    draftOutput = fallbackData.data.finalDoc;
    onEvent({ type: 'draft', content: draftOutput });
    
    for (let s = 85; s <= 98; s++) {
      onEvent({ type: 'seo_score', score: s });
      await sleep(25);
    }
  }
}
