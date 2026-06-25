import React from 'react';

interface SlideBaseProps {
  isActive: boolean;
  children: React.ReactNode;
  className?: string;
}

const SlideBase: React.FC<SlideBaseProps> = ({ isActive, children, className }) => {
  return (
    <div className={`wrapped-slide${isActive ? ' wrapped-slide--active' : ''}${className ? ` ${className}` : ''}`}>
      {isActive && children}
    </div>
  );
};

export default SlideBase;
