'use client';

import { useChat } from 'ai/react';
import { MessageCircle, X, Send, Sparkles } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999 }}>
      {isOpen && (
        <div style={{
          width: '380px', height: '600px', maxHeight: '80vh',
          background: 'rgba(10, 10, 11, 0.85)', backdropFilter: 'blur(30px)',
          border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '24px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
          display: 'flex', flexDirection: 'column', marginBottom: '16px',
          overflow: 'hidden', transition: 'all 0.3s ease'
        }}>
          {/* Header */}
          <div style={{
            padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)', background: 'rgba(255, 255, 255, 0.03)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                width: '32px', height: '32px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Sparkles size={16} color="#fff" />
              </div>
              <span style={{ fontWeight: 600, fontSize: '1rem', color: '#fff' }}>AI Assistant</span>
            </div>
            <button onClick={() => setIsOpen(false)} style={{
              background: 'transparent', border: 'none', color: '#a1a1aa', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px'
            }}>
              <X size={20} />
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', margin: 'auto', color: '#a1a1aa' }}>
                <p style={{ fontSize: '0.9rem' }}>How can I help you today?</p>
              </div>
            ) : (
              messages.map((m: any) => (
                <div key={m.id} style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  backgroundColor: m.role === 'user' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  border: m.role === 'user' ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#fff', padding: '12px 16px', borderRadius: '18px',
                  maxWidth: '85%', fontSize: '0.9rem', lineHeight: '1.5',
                  borderBottomRightRadius: m.role === 'user' ? '4px' : '18px',
                  borderBottomLeftRadius: m.role !== 'user' ? '4px' : '18px',
                }}>
                  {m.content}
                </div>
              ))
            )}
            {isLoading && (
              <div style={{
                alignSelf: 'flex-start', backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)', padding: '12px 16px',
                borderRadius: '18px', color: '#a1a1aa', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '8px'
              }}>
                <Sparkles size={12} className="animate-pulse" /> Thinking...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Form */}
          <form onSubmit={handleSubmit} style={{
            padding: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(255, 255, 255, 0.02)', display: 'flex', gap: '12px'
          }}>
            <input
              value={input}
              onChange={handleInputChange}
              placeholder="Ask anything..."
              style={{
                flex: 1, padding: '12px 16px', borderRadius: '16px',
                background: 'rgba(0, 0, 0, 0.5)', border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff', outline: 'none', fontSize: '0.9rem'
              }}
            />
            <button type="submit" disabled={isLoading || !input.trim()} style={{
              background: '#fff', color: '#000', width: '44px', height: '44px',
              borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: input.trim() ? 'pointer' : 'default',
              opacity: input.trim() ? 1 : 0.5, transition: 'transform 0.2s'
            }}>
              <Send size={18} />
            </button>
          </form>
        </div>
      )}

      {/* Toggle Button */}
      <button onClick={() => setIsOpen(!isOpen)} style={{
        width: '64px', height: '64px', borderRadius: '50%',
        background: 'linear-gradient(135deg, #10b981, #3b82f6)',
        border: 'none', boxShadow: '0 8px 30px rgba(59, 130, 246, 0.4)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        transform: isOpen ? 'scale(0.9) rotate(15deg)' : 'scale(1) rotate(0)',
      }}>
        {isOpen ? <X size={28} /> : <MessageCircle size={28} />}
      </button>
    </div>
  );
}
