const fs = require('fs');
const path = require('path');

const vaultRoot = path.resolve(__dirname, '../AI_Employee_Vault');
const inboxPath = path.join(vaultRoot, 'Inbox');
const plansPath = path.join(vaultRoot, 'Plans');
const pendingApprovalPath = path.join(vaultRoot, 'Pending_Approval');
const approvedPath = path.join(vaultRoot, 'Approved');
const donePath = path.join(vaultRoot, 'Done');
const failedPath = path.join(vaultRoot, 'Failed');
const logsPath = path.join(vaultRoot, 'Logs');
const briefingsPath = path.join(vaultRoot, 'Briefings');
const dashboardPath = path.join(vaultRoot, 'Dashboard.md');
const businessGoalsPath = path.join(vaultRoot, 'Business_Goals.md');

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function countMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir);
  return entries.filter((f) => f.toLowerCase().endsWith('.md')).length;
}

function countDoneToday() {
  if (!fs.existsSync(donePath)) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const entries = fs.readdirSync(donePath);
  let count = 0;
  for (const name of entries) {
    const full = path.join(donePath, name);
    try {
      const stat = fs.statSync(full);
      const mdate = stat.mtime.toISOString().slice(0, 10);
      if (mdate === today) {
        count += 1;
      }
    } catch (e) {}
  }
  return count;
}

function readLastLogLines(limit) {
  ensureDirectory(logsPath);
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(logsPath, `${today}.log`);
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.trim().split('\n');
  return lines.slice(-limit);
}

function parseLastActivityForTag(tag) {
  const lines = readLastLogLines(500);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.includes(tag)) {
      const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)/);
      if (tsMatch) {
        const ts = tsMatch[1];
        return new Date(ts);
      }
    }
  }
  return null;
}

function computeWatcherHealth() {
  const now = new Date();
  const thresholdMs = 60000;
  const watchers = [
    { id: 'whatsappWatcher', label: 'WhatsApp Watcher', tag: '[whatsappWatcher]' },
    { id: 'fileSystemWatcher', label: 'File System Watcher', tag: '[fileSystemWatcher]' },
    { id: 'approvalWatcher', label: 'Approval Watcher', tag: '[approvalWatcher]' },
    { id: 'email_mcp', label: 'Email MCP Server', tag: '[Email MCP Server]' },
    { id: 'whatsapp_mcp', label: 'WhatsApp MCP Server', tag: 'WhatsApp MCP Server' },
  ];
  const health = [];
  for (const w of watchers) {
    const last = parseLastActivityForTag(w.tag);
    if (!last) {
      health.push({
        id: w.id,
        label: w.label,
        status: 'unknown',
        lastSeen: null,
      });
    } else {
      const diff = now.getTime() - last.getTime();
      health.push({
        id: w.id,
        label: w.label,
        status: diff <= thresholdMs ? 'running' : 'stale',
        lastSeen: last.toISOString(),
      });
    }
  }
  return health;
}

function readBusinessGoals() {
  if (!fs.existsSync(businessGoalsPath)) return null;
  try {
    return fs.readFileSync(businessGoalsPath, 'utf8');
  } catch (e) {
    return null;
  }
}

function buildDashboardMarkdown(metrics, health) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  const totalCompleted = metrics.doneCount;
  const totalFailed = metrics.failedCount;
  const totalProcessed = totalCompleted + totalFailed;
  let failureRateText = 'N/A';
  if (totalProcessed > 0) {
    const failureRate = (totalFailed / totalProcessed) * 100;
    failureRateText = `${failureRate.toFixed(1)}%`;
  }

  const box = (title, inner) => {
    const lines = [`> ## ${title}`, ...inner.split('\n').map((l) => `> ${l}`)];
    return lines.join('\n');
  };

  const headerBlock = [
    '# AI Employee Dashboard',
    '',
    `Last Updated: ${dateStr}`,
  ].join('\n');

  const metricsTable = [
    '| Metric | Value |',
    '| --- | --- |',
    `| Tasks in Inbox | ${metrics.inboxCount} |`,
    `| Tasks Pending Approval | ${metrics.pendingApprovalCount} |`,
    `| Tasks Approved (waiting send) | ${metrics.approvedCount} |`,
    `| Tasks Completed (Done) | ${metrics.doneCount} |`,
    `| Permanently Failed Tasks | ${metrics.failedCount} |`,
    `| Tasks Completed Today | ${metrics.completedToday} |`,
    `| Failure Rate (Done vs Failed) | ${failureRateText} |`,
  ].join('\n');

  const healthTableRows = health
    .map((h) => {
      const statusLabel =
        h.status === 'running'
          ? 'Healthy'
          : h.status === 'stale'
          ? 'Stale / Possibly Stopped'
          : 'Unknown';
      const lastSeenText = h.lastSeen ? h.lastSeen : 'no recent activity';
      return `| ${h.label} | ${statusLabel} | ${lastSeenText} |`;
    })
    .join('\n');

  const healthTable = [
    '| Service | Status | Last Activity |',
    '| --- | --- | --- |',
    healthTableRows,
  ].join('\n');

  const notesList = (() => {
    const items = [];
    if (metrics.failedCount > 0) {
      items.push('- There are failed tasks. Investigate items in the Failed folder.');
    } else {
      items.push('- No failed tasks detected.');
    }
    if (metrics.pendingApprovalCount > 5) {
      items.push(`- Approval queue is growing (Pending_Approval=${metrics.pendingApprovalCount}). Consider reviewing approvals.`);
    } else {
      items.push('- Approval queue is within normal range.');
    }
    return items.join('\n');
  })();

  const content =
    headerBlock +
    '\n\n' +
    box('Key Metrics', metricsTable) +
    '\n\n' +
    box('System Health', healthTable) +
    '\n\n' +
    box('Notes', notesList);

  return content;
}

function buildBriefingMarkdown(metrics, health, businessGoals, recentLogLines) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  const totalCompleted = metrics.doneCount;
  const totalFailed = metrics.failedCount;
  const totalProcessed = totalCompleted + totalFailed;
  let failureRate = null;
  if (totalProcessed > 0) {
    failureRate = (totalFailed / totalProcessed) * 100;
  }

  const lines = [];
  lines.push('# Monday Morning CEO Briefing');
  lines.push(`**Date:** ${dateStr}`);
  lines.push('');
  lines.push('## Executive Summary');
  lines.push(
    'This briefing summarizes current workload, failure risk, and alignment with business goals.'
  );
  lines.push('');
  lines.push('## Task Summary');
  lines.push(`- Tasks Completed Today: ${metrics.completedToday}`);
  lines.push(`- Tasks Pending Approval: ${metrics.pendingApprovalCount}`);
  lines.push(`- Tasks in Inbox: ${metrics.inboxCount}`);
  lines.push(`- Permanently Failed Tasks: ${metrics.failedCount}`);
  lines.push('');
  lines.push('## Bottlenecks & Issues');
  if (metrics.pendingApprovalCount > 5) {
    lines.push(
      `- Approval bottleneck detected: ${metrics.pendingApprovalCount} tasks waiting in Pending_Approval.`
    );
  } else {
    lines.push('- No significant approval bottlenecks detected.');
  }
  if (metrics.failedCount > 0) {
    lines.push(
      `- There are ${metrics.failedCount} permanently failed tasks. These require investigation.`
    );
  } else {
    lines.push('- No failed tasks detected this week.');
  }
  lines.push('');
  lines.push('## Risk Analysis');
  if (failureRate === null) {
    lines.push('- Not enough completed tasks to estimate failure rate.');
  } else {
    lines.push(`- Overall failure rate (Done vs Failed): ${failureRate.toFixed(1)}%.`);
    if (failureRate > 5) {
      lines.push(
        '- Failure rate is above the target (<5%). This is a risk to reliability.'
      );
    } else {
      lines.push(
        '- Failure rate is within target (<5%). Reliability is acceptable based on current data.'
      );
    }
  }
  lines.push('');
  lines.push('## System Health Status');
  for (const h of health) {
    const statusLabel =
      h.status === 'running'
        ? 'Healthy'
        : h.status === 'stale'
        ? 'Stale / Possibly Stopped'
        : 'Unknown';
    const lastSeenText = h.lastSeen ? h.lastSeen : 'no recent activity';
    lines.push(`- ${h.label}: ${statusLabel} (last activity: ${lastSeenText})`);
  }
  lines.push('');
  lines.push('## Recent Activity');
  for (const line of recentLogLines) {
    lines.push(`- ${line}`);
  }
  lines.push('');
  if (businessGoals) {
    lines.push('## Business Goal Alignment');
    lines.push('');
    lines.push(businessGoals.trim());
  }

  return lines.join('\n');
}

function updateDashboard() {
  ensureDirectory(vaultRoot);
  ensureDirectory(briefingsPath);
  ensureDirectory(failedPath);

  const metrics = {
    inboxCount: countMarkdownFiles(inboxPath),
    plansCount: countMarkdownFiles(plansPath),
    pendingApprovalCount: countMarkdownFiles(pendingApprovalPath),
    approvedCount: countMarkdownFiles(approvedPath),
    doneCount: countMarkdownFiles(donePath),
    failedCount: countMarkdownFiles(failedPath),
    completedToday: countDoneToday(),
  };

  const health = computeWatcherHealth();
  const businessGoals = readBusinessGoals();
  const recentLogLines = readLastLogLines(10);

  const dashboardMd = buildDashboardMarkdown(metrics, health);
  fs.writeFileSync(dashboardPath, dashboardMd, 'utf8');

  const briefingMd = buildBriefingMarkdown(
    metrics,
    health,
    businessGoals,
    recentLogLines
  );

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const weekdayNames = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const weekday = weekdayNames[now.getDay()];
  const briefingFileName = `${dateStr}_${weekday}_Briefing.md`;
  const briefingFilePath = path.join(briefingsPath, briefingFileName);
  fs.writeFileSync(briefingFilePath, briefingMd, 'utf8');
}

module.exports = {
  updateDashboard,
};
