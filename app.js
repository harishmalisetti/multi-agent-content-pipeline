import { agentsConfig, topicsDatabase, generateDynamicSimulation } from './agents.js';

const BACKEND_URL = 'http://localhost:5000';

// DOM Elements
const agentsListContainer = document.getElementById('agents-list');
const topicSelect = document.getElementById('topic-select');
const customTopicGroup = document.getElementById('custom-topic-group');
const customTopicInput = document.getElementById('custom-topic-input');
const toneSelect = document.getElementById('tone-select');
const formatSelect = document.getElementById('format-select');
const launchBtn = document.getElementById('launch-btn');
const clearConsoleBtn = document.getElementById('clear-console-btn');
const consoleOutput = document.getElementById('console-output');
const tabRendered = document.getElementById('tab-rendered');
const tabRaw = document.getElementById('tab-raw');
const documentBody = document.getElementById('document-body');
const exportMDBtn = document.getElementById('export-md-btn');
const globalStatusText = document.getElementById('global-status');

// Metrics DOM
const metricWords = document.getElementById('metric-words');
const metricReadingTime = document.getElementById('metric-reading-time');
const seoScoreNum = document.getElementById('seo-score-num');
const seoProgressRing = document.getElementById('seo-progress-ring');
const seoCircleText = document.getElementById('seo-circle-text');
const metricSeoStatus = document.getElementById('metric-seo-status');
const keywordsContainer = document.getElementById('keywords-container');

// Modal DOM
const configModal = document.getElementById('config-modal');
const openConfigBtn = document.getElementById('open-config-btn');
const modalAgentSelect = document.getElementById('modal-agent-select');
const modalPromptTextarea = document.getElementById('modal-prompt-textarea');
const modalTempInput = document.getElementById('modal-temp-input');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalSaveBtn = document.getElementById('modal-save-btn');

// App State
let activeTab = 'rendered'; // 'rendered' | 'raw'
let generatedMarkdown = '';
let isRunning = false;
let customPromptEdits = {}; // key: agentId, value: prompt string

// Initialize Application
function init() {
  renderAgentCards();
  setupEventListeners();
  updateModalPromptFields();
  checkBackendHealth();
}

async function checkBackendHealth() {
  const statusBadge = document.getElementById('backend-status');
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`);
    const data = await res.json();
    if (data.status === 'ok') {
      if (data.geminiActive) {
        statusBadge.innerText = '🔌 Server: Gemini Live';
        statusBadge.style.background = 'rgba(39, 174, 96, 0.1)';
        statusBadge.style.borderColor = 'rgba(39, 174, 96, 0.3)';
        statusBadge.style.color = '#27ae60';
      } else {
        statusBadge.innerText = '🔌 Server: Simulation';
        statusBadge.style.background = 'rgba(0, 242, 254, 0.1)';
        statusBadge.style.borderColor = 'rgba(0, 242, 254, 0.3)';
        statusBadge.style.color = '#00f2fe';
      }
    }
  } catch (err) {
    statusBadge.innerText = '🔌 Server Offline';
    statusBadge.style.background = 'rgba(235, 87, 87, 0.1)';
    statusBadge.style.borderColor = 'rgba(235, 87, 87, 0.3)';
    statusBadge.style.color = '#eb5757';
  }
}

// Render Agent Network Cards
function renderAgentCards() {
  agentsListContainer.innerHTML = '';
  Object.values(agentsConfig).forEach(agent => {
    const card = document.createElement('div');
    card.className = 'agent-card state-idle';
    card.id = `card-${agent.id}`;
    card.style.setProperty('--agent-color', agent.color);
    card.style.setProperty('--agent-glow', agent.color + '40');
    
    card.innerHTML = `
      <div class="agent-avatar">${agent.avatar}</div>
      <div class="agent-info">
        <div class="agent-meta">
          <span class="agent-name">${agent.name}</span>
          <span class="agent-status-badge" id="badge-${agent.id}">Idle</span>
        </div>
        <div class="agent-role">${agent.role}</div>
        <div class="agent-progress-bar">
          <div class="agent-progress-fill" id="progress-${agent.id}"></div>
        </div>
      </div>
    `;
    
    // Clicking agent card opens configuration modal prefilled
    card.addEventListener('click', () => {
      if (isRunning) return;
      modalAgentSelect.value = agent.id;
      updateModalPromptFields();
      openModal();
    });

    agentsListContainer.appendChild(card);
  });
}

// Setup Event Handlers
function setupEventListeners() {
  // Topic dropdown toggles custom text input
  topicSelect.addEventListener('change', () => {
    if (topicSelect.value === 'custom') {
      customTopicGroup.style.display = 'block';
    } else {
      customTopicGroup.style.display = 'none';
    }
  });

  // Launch pipeline simulation
  launchBtn.addEventListener('click', () => {
    if (isRunning) return;
    runPipeline();
  });

  // Clear log console
  clearConsoleBtn.addEventListener('click', () => {
    consoleOutput.innerHTML = `
      <div class="console-line">
        <span class="console-timestamp">[${getTimestamp()}]</span>
        <span class="console-tag" style="background: rgba(255,255,255,0.1); color: var(--text-secondary)">system</span>
        <span class="console-message">Console cleared. Pipeline operational.</span>
      </div>
    `;
  });

  // Tab management for content preview
  tabRendered.addEventListener('click', () => {
    activeTab = 'rendered';
    tabRendered.classList.add('active');
    tabRaw.classList.remove('active');
    renderPreview();
  });

  tabRaw.addEventListener('click', () => {
    activeTab = 'raw';
    tabRaw.classList.add('active');
    tabRendered.classList.remove('active');
    renderPreview();
  });

  // Export Markdown button
  exportMDBtn.addEventListener('click', () => {
    if (!generatedMarkdown) return;
    const blob = new Blob([generatedMarkdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus_article_${getTimestamp().replace(/:/g, '-')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    logToConsole('system', 'System Download triggered for final Markdown payload.', 'rgba(255,255,255,0.15)', 'var(--text-primary)');
  });

  // Modal actions
  openConfigBtn.addEventListener('click', openModal);
  modalCloseBtn.addEventListener('click', closeModal);
  modalAgentSelect.addEventListener('change', updateModalPromptFields);
  
  modalSaveBtn.addEventListener('click', async () => {
    const selectedAgentId = modalAgentSelect.value;
    const newPrompt = modalPromptTextarea.value;
    customPromptEdits[selectedAgentId] = newPrompt;
    
    try {
      await fetch(`${BACKEND_URL}/api/agents/${selectedAgentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt: newPrompt })
      });
    } catch (err) {
      console.log('Failed to save prompt override on server:', err);
    }
    
    logToConsole('system', `Updated prompt configuration override for agent node: [${agentsConfig[selectedAgentId].name}]`, 'rgba(255,255,255,0.15)', 'var(--text-primary)');
    closeModal();
  });

  // Node Graph SVGs clicks open matching modal configurations
  const nodes = ['researcher', 'outliner', 'writer', 'seo', 'editor', 'publisher'];
  nodes.forEach(nodeId => {
    const nodeElement = document.getElementById(`node-${nodeId}`);
    if (nodeElement) {
      nodeElement.style.cursor = 'pointer';
      nodeElement.addEventListener('click', () => {
        if (isRunning) return;
        modalAgentSelect.value = nodeId;
        updateModalPromptFields();
        openModal();
      });
    }
  });
}

// Modal Helpers
function openModal() {
  configModal.classList.add('active');
}

function closeModal() {
  configModal.classList.remove('active');
}

function updateModalPromptFields() {
  const agentId = modalAgentSelect.value;
  const agent = agentsConfig[agentId];
  if (!agent) return;

  // Use edited prompt if exists, otherwise base system prompt
  modalPromptTextarea.value = customPromptEdits[agentId] || agent.systemPrompt;
  modalTempInput.value = agent.stats.temperature;
}

// Log Terminal Printing Helper
function logToConsole(tag, message, tagColor, textColor = 'var(--text-primary)') {
  const line = document.createElement('div');
  line.className = 'console-line';
  
  line.innerHTML = `
    <span class="console-timestamp">[${getTimestamp()}]</span>
    <span class="console-tag" style="background: ${tagColor}; color: #fff">${tag}</span>
    <span class="console-message" style="color: ${textColor}">${message}</span>
  `;
  
  consoleOutput.appendChild(line);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function getTimestamp() {
  const d = new Date();
  return d.toTimeString().split(' ')[0];
}

// Set circular SEO progress gauge
function setSEOScore(score) {
  seoScoreNum.innerText = score;
  seoCircleText.innerText = `${score}%`;
  
  // Circumference is 2 * PI * R = 2 * 3.14159 * 20 = 125.66 -> approx 126
  const strokeDashoffset = 126 - (126 * score) / 100;
  seoProgressRing.style.strokeDashoffset = strokeDashoffset;
  
  if (score < 40) {
    metricSeoStatus.innerText = 'Critical Needs';
    metricSeoStatus.style.color = 'var(--color-publisher)';
  } else if (score < 75) {
    metricSeoStatus.innerText = 'Needs Optimize';
    metricSeoStatus.style.color = 'var(--color-seo)';
  } else {
    metricSeoStatus.innerText = 'Highly Optimized';
    metricSeoStatus.style.color = 'var(--color-editor)';
  }
}

// Switch render state previewer
function renderPreview() {
  if (!generatedMarkdown) {
    documentBody.innerHTML = `
      <div style="color: var(--text-muted); text-align: center; margin-top: 5rem;">
        <span style="font-size: 2.5rem; display: block; margin-bottom: 1rem;">📝</span>
        Generated article content will compile here progressively as the agents run.
      </div>
    `;
    return;
  }

  if (activeTab === 'raw') {
    documentBody.className = 'preview-body markdown-raw';
    documentBody.innerText = generatedMarkdown;
  } else {
    documentBody.className = 'preview-body markdown-rendered';
    documentBody.innerHTML = renderMarkdown(generatedMarkdown);
  }
}

// Markdown parser
function renderMarkdown(md) {
  if (!md) return "";
  
  // 1. Extract code blocks
  const codeBlocks = [];
  let html = md.replace(/```([a-zA-Z0-9]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `__CODE_BLOCK_PLACEHOLDER_${codeBlocks.length}__`;
    codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
    return placeholder;
  });
  
  // Escape general HTML tags
  html = escapeHtml(html);
  
  // Bold
  html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');
  
  // Headers
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  
  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  // Lists
  html = html.replace(/^\* (.*?)$/gm, '<li>$1</li>');
  html = html.replace(/^- (.*?)$/gm, '<li>$1</li>');
  html = html.replace(/^\d+\. (.*?)$/gm, '<li>$1</li>');
  
  // Split into lines to wrap block level items
  let lines = html.split('\n');
  let result = [];
  let inList = false;
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      continue;
    }
    
    if (line.startsWith('<h1>') || line.startsWith('<h2>') || line.startsWith('<h3>') || line.startsWith('<hr>') || line.startsWith('__CODE_BLOCK_PLACEHOLDER_')) {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push(line);
    } else if (line.startsWith('<li>')) {
      if (!inList) {
        result.push('<ul>');
        inList = true;
      }
      result.push(line);
    } else {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push(`<p>${lines[i]}</p>`);
    }
  }
  
  if (inList) {
    result.push('</ul>');
  }
  
  let finalHtml = result.join('\n');
  
  // Restore code blocks back
  for (let i = 0; i < codeBlocks.length; i++) {
    finalHtml = finalHtml.replace(`__CODE_BLOCK_PLACEHOLDER_${i}__`, codeBlocks[i]);
  }
  
  return finalHtml;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Utility to sleep/pause
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// UI reset helper between runs
function resetUI() {
  generatedMarkdown = '';
  renderPreview();
  setSEOScore(0);
  metricWords.innerText = '0';
  metricReadingTime.innerText = 'Est. 0m read';
  keywordsContainer.innerHTML = '<span style="font-size: 0.8rem; color: var(--text-muted); font-style: italic;">No audit run yet</span>';
  exportMDBtn.disabled = true;

  // Reset graph elements
  const paths = document.querySelectorAll('.graph-path');
  paths.forEach(p => p.className.baseVal = 'graph-path');

  const circles = document.querySelectorAll('.node-circle');
  circles.forEach(c => c.className.baseVal = 'node-circle');

  const labels = document.querySelectorAll('.node-label');
  labels.forEach(l => l.className.baseVal = 'node-label');
  
  // Reset progress fills
  const fills = document.querySelectorAll('.agent-progress-fill');
  fills.forEach(f => f.style.width = '0%');
}

// Pipeline Orchestrator
async function runPipeline() {
  isRunning = true;
  launchBtn.disabled = true;
  launchBtn.innerHTML = `<span>⏳</span> Pipeline Processing...`;
  topicSelect.disabled = true;
  customTopicInput.disabled = true;
  toneSelect.disabled = true;
  formatSelect.disabled = true;
  globalStatusText.innerText = 'Execution Running...';

  resetUI();

  const selectValue = topicSelect.value;
  const tone = toneSelect.value;
  const format = formatSelect.value;
  const customTitle = customTopicInput.value.trim();

  const topicName = selectValue === 'custom' 
    ? (customTitle || 'Emerging Innovations in Modern Systems') 
    : selectValue;

  logToConsole('system', `Initiating backend pipeline sequence for topic: "${topicName}"...`, 'rgba(255,255,255,0.15)');

  try {
    // 1. Post to initiate run and get runId
    const runRes = await fetch(`${BACKEND_URL}/api/pipeline/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: topicName,
        tone,
        format,
        prompts: customPromptEdits
      })
    });

    if (!runRes.ok) {
      throw new Error(`Server failed to initialize pipeline: ${runRes.statusText}`);
    }

    const { runId } = await runRes.json();

    // 2. Open Server-Sent Events stream
    const eventSource = new EventSource(`${BACKEND_URL}/api/pipeline/stream?runId=${runId}`);
    
    let activeAgentId = null;
    let fillProgressInterval = null;
    let hasCompleted = false;

    eventSource.onmessage = (e) => {
      const event = JSON.parse(e.data);
      
      if (event.type === 'log') {
        logToConsole(event.tag, event.message, event.color, event.textColor);
      } 
      else if (event.type === 'status') {
        const { agentId, status } = event;
        
        if (status === 'active') {
          activeAgentId = agentId;
          activateAgentUI(agentId);
        } else if (status === 'complete') {
          deactivateAgentUI(agentId);
        }
      }
      else if (event.type === 'draft') {
        generatedMarkdown = event.content;
        renderPreview();
        
        const words = generatedMarkdown.split(/\s+/).filter(w => w.length > 0).length;
        metricWords.innerText = words;
        metricReadingTime.innerText = `Est. ${Math.ceil(words / 200)}m read`;
      }
      else if (event.type === 'keywords') {
        keywordsContainer.innerHTML = '';
        event.keywords.forEach(keyword => {
          const chip = document.createElement('span');
          chip.className = 'logo-badge';
          chip.style.borderColor = 'rgba(39, 174, 96, 0.4)';
          chip.style.color = '#27ae60';
          chip.style.background = 'rgba(39, 174, 96, 0.1)';
          chip.innerHTML = `✓ ${keyword}`;
          keywordsContainer.appendChild(chip);
        });
      }
      else if (event.type === 'seo_score') {
        setSEOScore(event.score);
      }
      else if (event.type === 'complete') {
        hasCompleted = true;
        eventSource.close();
        finalizePipeline(true);
      }
    };

    eventSource.onerror = (e) => {
      eventSource.close();
      if (!hasCompleted) {
        finalizePipeline(false);
      }
    };

    // Helper Node UI controllers
    function activateAgentUI(agentId) {
      const agent = agentsConfig[agentId];
      const card = document.getElementById(`card-${agentId}`);
      const badge = document.getElementById(`badge-${agentId}`);
      const fill = document.getElementById(`progress-${agentId}`);
      const svgCircle = document.getElementById(`node-${agentId}`).querySelector('.node-circle');
      const svgLabel = document.getElementById(`node-${agentId}`).querySelector('.node-label');

      card.className = 'agent-card state-active';
      badge.innerText = 'Active';
      svgCircle.className.baseVal = 'node-circle active';
      svgCircle.style.setProperty('--node-color', agent.color);
      svgLabel.className.baseVal = 'node-label active';

      // Animate progress loading bar
      let progress = 0;
      fillProgressInterval = setInterval(() => {
        if (progress < 90) {
          progress += Math.floor(Math.random() * 8) + 3;
          fill.style.width = `${Math.min(progress, 90)}%`;
        }
      }, 150);
    }

    function deactivateAgentUI(agentId) {
      const agent = agentsConfig[agentId];
      const card = document.getElementById(`card-${agentId}`);
      const badge = document.getElementById(`badge-${agentId}`);
      const fill = document.getElementById(`progress-${agentId}`);
      const svgCircle = document.getElementById(`node-${agentId}`).querySelector('.node-circle');
      const svgLabel = document.getElementById(`node-${agentId}`).querySelector('.node-label');

      if (fillProgressInterval) {
        clearInterval(fillProgressInterval);
      }
      fill.style.width = '100%';

      card.className = 'agent-card state-complete';
      badge.innerText = 'Done';
      svgCircle.className.baseVal = 'node-circle complete';
      svgLabel.className.baseVal = 'node-label';

      // Activate downstream path connector
      const nextPaths = {
        researcher: 'path-1',
        outliner: 'path-2',
        writer: 'path-3',
        seo: 'path-4',
        editor: 'path-5'
      };
      const nextPathId = nextPaths[agentId];
      if (nextPathId) {
        const pathElement = document.getElementById(nextPathId);
        if (pathElement) {
          pathElement.className.baseVal = 'graph-path active';
          pathElement.style.setProperty('--path-color', agent.color);
        }
      }

      const prevPaths = {
        outliner: 'path-1',
        writer: 'path-2',
        seo: 'path-3',
        editor: 'path-4',
        publisher: 'path-5'
      };
      const prevPathId = prevPaths[agentId];
      if (prevPathId) {
        const pathElement = document.getElementById(prevPathId);
        if (pathElement) {
          pathElement.className.baseVal = 'graph-path complete';
        }
      }
    }

    function finalizePipeline(success) {
      globalStatusText.innerText = success ? 'Completed' : 'Error';
      launchBtn.disabled = false;
      launchBtn.innerHTML = `<span>🚀</span> Re-run Pipeline`;
      topicSelect.disabled = false;
      customTopicInput.disabled = false;
      toneSelect.disabled = false;
      formatSelect.disabled = false;
      exportMDBtn.disabled = !success;
      isRunning = false;
      
      if (!success) {
        logToConsole('system', 'Pipeline connection closed unexpectedly or server offline.', 'rgba(235, 87, 87, 0.2)', '#eb5757');
      }
    }

  } catch (err) {
    logToConsole('system', `Pipeline connection error: ${err.message}`, 'rgba(235,87,87,0.2)', '#eb5757');
    globalStatusText.innerText = 'Error';
    launchBtn.disabled = false;
    launchBtn.innerHTML = `<span>🚀</span> Launch AI Pipeline`;
    topicSelect.disabled = false;
    customTopicInput.disabled = false;
    toneSelect.disabled = false;
    formatSelect.disabled = false;
    isRunning = false;
  }
}

// Run initial configurations
init();
