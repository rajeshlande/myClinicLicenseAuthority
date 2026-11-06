import React from 'react';
import { parseRichNotes } from '../lib/notes.mjs';

function renderRuns(runs) {
  return runs.map((run, idx) => {
    if (run.type === 'bold') {
      return (
        <strong
          key={idx}
          style={{ color: 'var(--text-primary)' }}
          className="font-semibold"
        >
          {run.value}
        </strong>
      );
    }
    if (run.type === 'italic') {
      return (
        <em key={idx} className="italic">
          {run.value}
        </em>
      );
    }
    if (run.type === 'code') {
      return (
        <code
          key={idx}
          style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--accent-primary)',
          }}
          className="rounded px-1.5 py-0.5 font-mono text-[10px] font-medium"
        >
          {run.value}
        </code>
      );
    }
    return <React.Fragment key={idx}>{run.value}</React.Fragment>;
  });
}

export default function RichNotesView({ notes, compact = false }) {
  const blocks = parseRichNotes(notes);
  if (!blocks.length) return null;

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-well)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-secondary)',
      }}
      className={`${
        compact ? 'mt-1.5 px-2 py-1 text-[11px]' : 'mt-2 px-3 py-2 text-xs'
      } space-y-1 rounded-lg leading-relaxed`}
    >
      {blocks.map((block, bIdx) => {
        if (block.type === 'list') {
          return (
            <ul key={bIdx} className="list-disc space-y-0.5 pl-4">
              {block.items.map((itemRuns, iIdx) => (
                <li key={iIdx}>{renderRuns(itemRuns)}</li>
              ))}
            </ul>
          );
        }
        return <p key={bIdx}>{renderRuns(block.runs)}</p>;
      })}
    </div>
  );
}
