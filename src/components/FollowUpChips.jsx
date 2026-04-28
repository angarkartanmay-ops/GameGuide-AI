import React from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * Parses [?] follow-up questions from AI response text.
 * Handles them whether they appear on separate lines, inline, or mixed.
 * Returns { cleanText, followUps[] }
 */
export function parseFollowUps(text) {
  if (!text) return { cleanText: '', followUps: [] };

  const followUps = [];

  // Regex to match [?] followed by question text (up to next [?] or end)
  const markerRegex = /\[\?\]\s*/g;

  // Find the FIRST occurrence of [?] — everything before it is content
  const firstMatch = text.search(markerRegex);

  let cleanText;
  let questionBlock;

  if (firstMatch === -1) {
    // No follow-ups found at all
    return { cleanText: text.trim(), followUps: [] };
  }

  // Split: content before first [?] vs the question block
  cleanText = text.slice(0, firstMatch).trim();
  questionBlock = text.slice(firstMatch);

  // Extract each question: split on [?] and clean up
  const questions = questionBlock.split(/\[\?\]\s*/);

  for (const q of questions) {
    // Strip markdown artifacts that bleed into question text
    let trimmed = q.trim()
      .replace(/^#+\s*/gm, '')         // Remove heading markers (### etc.)
      .replace(/\*\*/g, '')             // Remove bold markers
      .replace(/^\s*[-*]\s*/gm, '')     // Remove bullet points
      .replace(/\n.*/g, '')             // Only keep the first line
      .trim()
      .replace(/\??[\s.]*$/, '?')       // Ensure ends with exactly one ?
      .replace(/\?\?+$/, '?');          // Collapse multiple ?
    if (trimmed.length > 5 && trimmed.length < 200) {
      followUps.push(trimmed);
    }
  }

  // Clean trailing whitespace/newlines from content
  cleanText = cleanText.replace(/[\n\s]+$/, '');

  return { cleanText, followUps };
}

export default function FollowUpChips({ followUps, onChipClick }) {
  if (!followUps || followUps.length === 0) return null;

  return (
    <div className="followup-chips">
      <div className="followup-label">
        <HelpCircle size={14} />
        <span>You might also want to ask:</span>
      </div>
      <div className="followup-list">
        {followUps.map((question, index) => (
          <button
            key={index}
            className="followup-chip glass-panel"
            onClick={() => onChipClick(question)}
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}
