import React from 'react';

const SidebarKitsIcon: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <svg className={className} viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="6" width="9.5" height="9.5" rx="2.5" stroke="currentColor" strokeWidth="2.2" />
      <rect x="18.5" y="6" width="9.5" height="9.5" rx="2.5" stroke="currentColor" strokeWidth="2.2" />
      <rect x="6" y="18.5" width="9.5" height="9.5" rx="2.5" stroke="currentColor" strokeWidth="2.2" />
      <rect x="18.5" y="18.5" width="9.5" height="9.5" rx="2.5" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="10.75" cy="10.75" r="1.5" fill="currentColor" />
      <circle cx="23.25" cy="10.75" r="1.5" fill="currentColor" />
      <circle cx="10.75" cy="23.25" r="1.5" fill="currentColor" />
      <circle cx="23.25" cy="23.25" r="1.5" fill="currentColor" />
    </svg>
  );
};

export default SidebarKitsIcon;
