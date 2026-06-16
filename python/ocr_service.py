#!/usr/bin/env python3
"""
SeeHTML OCR Service - Text extraction from images
Supports: pytesseract (Tesseract OCR) and easyocr (Deep learning)
Usage: python ocr_service.py <image_path> [--engine tesseract|easyocr] [--lang chi_sim+eng]
"""

import sys
import json
import os
import base64
import argparse

def ocr_tesseract(image_path: str, lang: str = "chi_sim+eng") -> dict:
    """OCR using Tesseract (requires: pip install pytesseract, install tesseract-ocr)"""
    try:
        import pytesseract
        from PIL import Image
        
        img = Image.open(image_path)
        text = pytesseract.image_to_string(img, lang=lang)
        data = pytesseract.image_to_data(img, lang=lang, output_type=pytesseract.Output.DICT)
        
        # Extract word-level boxes
        words = []
        for i in range(len(data['text'])):
            if data['text'][i].strip():
                words.append({
                    'text': data['text'][i],
                    'confidence': data['conf'][i],
                    'bbox': {
                        'x': data['left'][i],
                        'y': data['top'][i],
                        'w': data['width'][i],
                        'h': data['height'][i]
                    }
                })
        
        return {
            'status': 'ok',
            'engine': 'tesseract',
            'text': text.strip(),
            'words': words,
            'lang': lang
        }
    except ImportError:
        return {'status': 'error', 'message': 'pytesseract not installed. Run: pip install pytesseract'}
    except Exception as e:
        return {'status': 'error', 'message': str(e)}

def ocr_easyocr(image_path: str, lang: str = "ch_sim+en") -> dict:
    """OCR using EasyOCR (deep learning, better for Chinese)"""
    try:
        import easyocr
        
        langs = lang.replace('+', ' ').replace('_', '-').split()
        if 'chi-sim' in langs: langs[langs.index('chi-sim')] = 'ch_sim'
        
        reader = easyocr.Reader(langs, gpu=False)
        results = reader.readtext(image_path)
        
        words = []
        full_text = []
        for (bbox, text, confidence) in results:
            words.append({
                'text': text,
                'confidence': round(confidence * 100, 1),
                'bbox': {
                    'x': int(min(p[0] for p in bbox)),
                    'y': int(min(p[1] for p in bbox)),
                    'w': int(max(p[0] for p in bbox) - min(p[0] for p in bbox)),
                    'h': int(max(p[1] for p in bbox) - min(p[1] for p in bbox))
                }
            })
            full_text.append(text)
        
        return {
            'status': 'ok',
            'engine': 'easyocr',
            'text': '\n'.join(full_text),
            'words': words,
            'lang': lang
        }
    except ImportError:
        return {'status': 'error', 'message': 'easyocr not installed. Run: pip install easyocr'}
    except Exception as e:
        return {'status': 'error', 'message': str(e)}

def ocr_from_base64(b64_data: str, engine: str = "tesseract", lang: str = "chi_sim+eng") -> dict:
    """OCR from base64 encoded image"""
    import tempfile
    img_data = base64.b64decode(b64_data)
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
        f.write(img_data)
        tmp_path = f.name
    
    try:
        if engine == 'easyocr':
            return ocr_easyocr(tmp_path, lang)
        else:
            return ocr_tesseract(tmp_path, lang)
    finally:
        os.unlink(tmp_path)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='SeeHTML OCR Service')
    parser.add_argument('input', help='Image path or "base64:<data>"')
    parser.add_argument('--engine', default='tesseract', choices=['tesseract', 'easyocr'])
    parser.add_argument('--lang', default='chi_sim+eng', help='OCR language (e.g., chi_sim+eng, eng, jpn)')
    args = parser.parse_args()
    
    if args.input.startswith('base64:'):
        b64 = args.input[7:]
        result = ocr_from_base64(b64, args.engine, args.lang)
    else:
        if args.engine == 'easyocr':
            result = ocr_easyocr(args.input, args.lang)
        else:
            result = ocr_tesseract(args.input, args.lang)
    
    print(json.dumps(result, ensure_ascii=False, indent=2))
