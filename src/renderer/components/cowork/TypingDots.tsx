import React from 'react';

const TYPING_DOT_DELAYS_MS = [0, 150, 300];

export const TypingDots: React.FC = () => (
  <div className="flex items-center space-x-1.5 py-1" aria-hidden="true">
    {TYPING_DOT_DELAYS_MS.map(delay => (
      <div
        key={delay}
        className="h-2 w-2 rounded-full bg-primary animate-bounce motion-reduce:animate-none"
        style={{ animationDelay: `${delay}ms` }}
      />
    ))}
  </div>
);

export default TypingDots;
