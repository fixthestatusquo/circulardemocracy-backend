import { describe, it, expect } from 'vitest';

describe('URL Utilities', () => {
  it('should extract subdomain from URL', () => {
    const extractSubdomain = (url: string) => {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const parts = hostname.split('.');
      
      if (parts.length >= 3) {
        return parts[0];
      }
      
      throw new Error(`No subdomain found in URL: ${url}`);
    };

    expect(extractSubdomain('https://climate.example.com/page')).toBe('climate');
    expect(extractSubdomain('https://action.subdomain.example.com/page')).toBe('action');
    expect(() => extractSubdomain('https://example.com')).toThrow('No subdomain found');
  });

  it('should extract text from HTML', () => {
    const extractTextFromHtml = (html: string) => {
      let text = html.replace(/<script[^>]*>.*?<\/script>/gis, '');
      text = text.replace(/<style[^>]*>.*?<\/style>/gis, '');
      text = text.replace(/<[^>]+>/g, ' ');
      text = text.replace(/&nbsp;/g, ' ');
      text = text.replace(/&amp;/g, '&');
      text = text.replace(/&lt;/g, '<');
      text = text.replace(/&gt;/g, '>');
      text = text.replace(/&quot;/g, '"');
      text = text.replace(/&#39;/g, "'");
      text = text.replace(/\s+/g, ' ');
      text = text.trim();
      
      if (!text || text.length < 10) {
        throw new Error('No meaningful text content found in URL');
      }
      
      return text;
    };

    const html = '<html><head><title>Test</title></head><body><h1>Climate Action</h1><p>We need urgent action on climate change.</p></body></html>';
    const text = extractTextFromHtml(html);
    
    expect(text).toContain('Climate Action');
    expect(text).toContain('urgent action on climate change');
    expect(text).not.toContain('<h1>');
    expect(text).not.toContain('<p>');
  });

  it('should handle HTML entities', () => {
    const extractTextFromHtml = (html: string) => {
      let text = html.replace(/<script[^>]*>.*?<\/script>/gis, '');
      text = text.replace(/<style[^>]*>.*?<\/style>/gis, '');
      text = text.replace(/<[^>]+>/g, ' ');
      text = text.replace(/&nbsp;/g, ' ');
      text = text.replace(/&amp;/g, '&');
      text = text.replace(/&lt;/g, '<');
      text = text.replace(/&gt;/g, '>');
      text = text.replace(/&quot;/g, '"');
      text = text.replace(/&#39;/g, "'");
      text = text.replace(/\s+/g, ' ');
      text = text.trim();
      
      if (!text || text.length < 10) {
        throw new Error('No meaningful text content found in URL');
      }
      
      return text;
    };

    const html = '<p>Test&nbsp;&amp;&nbsp;more&nbsp;text</p>';
    const text = extractTextFromHtml(html);
    
    expect(text).toBe('Test & more text');
  });

  it('should remove script and style tags', () => {
    const extractTextFromHtml = (html: string) => {
      let text = html.replace(/<script[^>]*>.*?<\/script>/gis, '');
      text = text.replace(/<style[^>]*>.*?<\/style>/gis, '');
      text = text.replace(/<[^>]+>/g, ' ');
      text = text.replace(/&nbsp;/g, ' ');
      text = text.replace(/&amp;/g, '&');
      text = text.replace(/&lt;/g, '<');
      text = text.replace(/&gt;/g, '>');
      text = text.replace(/&quot;/g, '"');
      text = text.replace(/&#39;/g, "'");
      text = text.replace(/\s+/g, ' ');
      text = text.trim();
      
      if (!text || text.length < 10) {
        throw new Error('No meaningful text content found in URL');
      }
      
      return text;
    };

    const html = '<p>Visible text</p><script>alert("hidden")</script><style>.hidden { display: none; }</style>';
    const text = extractTextFromHtml(html);
    
    expect(text).toBe('Visible text');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('hidden');
  });
});
