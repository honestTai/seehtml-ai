//! PPTX Builder - OpenXML PowerPoint generation
use seehtml_core::*;
use std::io::{Cursor, Write};

pub fn build_pptx(doc: &Document, theme: &PresentationTheme) -> Result<Vec<u8>> {
    (|| -> std::result::Result<Vec<u8>, zip::result::ZipError> {
        let mut buf = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(&mut buf);
        let o = zip::write::FileOptions::<()>::default().compression_method(zip::CompressionMethod::Deflated);
        let n = doc.sections.len();
        zip.start_file("[Content_Types].xml", o)?;
        zip.write_all(ct_xml(n).as_bytes())?;
        zip.start_file("_rels/.rels", o)?; zip.write_all(rels_xml().as_bytes())?;
        zip.start_file("docProps/app.xml", o)?; zip.write_all(app_xml(doc,theme).as_bytes())?;
        zip.start_file("docProps/core.xml", o)?; zip.write_all(core_xml(doc).as_bytes())?;
        zip.start_file("ppt/presentation.xml", o)?; zip.write_all(pres_xml(n).as_bytes())?;
        zip.start_file("ppt/_rels/presentation.xml.rels", o)?; zip.write_all(pres_rels_xml(n).as_bytes())?;
        zip.start_file("ppt/slideMasters/slideMaster1.xml", o)?; zip.write_all(sm_xml().as_bytes())?;
        zip.start_file("ppt/slideMasters/_rels/slideMaster1.xml.rels", o)?; zip.write_all(sm_rels_xml().as_bytes())?;
        zip.start_file("ppt/slideLayouts/slideLayout1.xml", o)?; zip.write_all(sl_xml().as_bytes())?;
        zip.start_file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", o)?; zip.write_all(sl_rels_xml().as_bytes())?;
        zip.start_file("ppt/theme/theme1.xml", o)?; zip.write_all(th_xml(theme).as_bytes())?;
        for (i, s) in doc.sections.iter().enumerate() {
            let num = i + 1;
            zip.start_file(format!("ppt/slides/slide{}.xml", num), o)?;
            zip.write_all(sd_xml(s, theme).as_bytes())?;
            zip.start_file(format!("ppt/slides/_rels/slide{}.xml.rels", num), o)?;
            zip.write_all(sd_rels_xml().as_bytes())?;
        }
        zip.finish()?; Ok(buf.into_inner())
    })().map_err(|e| SeeHtmlError::Other(format!("Zip error: {}", e)))
}

fn ct_xml(n: usize) -> String {
    let mut s = String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>"#);
    for i in 1..=n {
        s.push_str(&format!(r#"<Override PartName="/ppt/slides/slide{}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>"#, i));
    }
    s.push_str("</Types>"); s
}

fn rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>"#.to_string()
}

fn app_xml(doc: &Document, theme: &PresentationTheme) -> String {
    format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>{}</Application><Slides>{}</Slides></Properties>"#, theme.name, doc.sections.len())
}

fn core_xml(doc: &Document) -> String {
    format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{}</dc:title><dc:creator>{}</dc:creator></cp:coreProperties>"#, doc.title, doc.metadata.author.as_deref().unwrap_or("SeeHTML"))
}

fn pres_xml(n: usize) -> String {
    let mut ids = String::new();
    for i in 1..=n { ids.push_str(&format!(r#"<p:sldId id="{}" r:id="rId{}"/>"#, 255+i, i+1)); }
    format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>{}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>"#, ids)
}

fn pres_rels_xml(n: usize) -> String {
    let mut rs = String::new();
    for i in 1..=n { rs.push_str(&format!(r#"<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{}.xml"/>"#, i+2, i)); }
    format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>{}</Relationships>"#, rs)
}

fn sm_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>"#.to_string()
}

fn sm_rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>"#.to_string()
}

fn sl_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="title"><p:cSld name="Title Slide"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld></p:sldLayout>"#.to_string()
}

fn sl_rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>"#.to_string()
}

fn th_xml(theme: &PresentationTheme) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="{}"><a:themeElements><a:clrScheme name="SeeHTML"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="333333"/></a:dk2><a:lt2><a:srgbClr val="CCCCCC"/></a:lt2><a:accent1><a:srgbClr val="{}"/></a:accent1><a:accent2><a:srgbClr val="{}"/></a:accent2><a:accent3><a:srgbClr val="{}"/></a:accent3><a:accent4><a:srgbClr val="{}"/></a:accent4><a:accent5><a:srgbClr val="{}"/></a:accent5><a:accent6><a:srgbClr val="{}"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="SeeHTML"><a:majorFont><a:latin typeface="{}"/><a:ea typeface="{}"/></a:majorFont><a:minorFont><a:latin typeface="{}"/><a:ea typeface="{}"/></a:minorFont></a:fontScheme><a:fmtScheme name="SeeHTML"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>"#,
        theme.name,
        theme.primary_color.trim_start_matches('#'),
        theme.secondary_color.trim_start_matches('#'),
        theme.accent_colors.get(0).map(|s| s.trim_start_matches('#')).unwrap_or("F59E0B"),
        theme.accent_colors.get(1).map(|s| s.trim_start_matches('#')).unwrap_or("EF4444"),
        theme.accent_colors.get(2).map(|s| s.trim_start_matches('#')).unwrap_or("64748B"),
        theme.accent_colors.get(3).map(|s| s.trim_start_matches('#')).unwrap_or("CBD5E1"),
        theme.font_family,
        theme.font_family,
        theme.font_family,
        theme.font_family,
    )
}

fn sd_xml(section: &DocumentSection, theme: &PresentationTheme) -> String {
    let heading = section.heading.as_deref().unwrap_or("");
    let content = xml_escape(&section.content);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="274320"/><a:ext cx="10820400" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="3200" b="1"><a:solidFill><a:srgbClr val="{}"/></a:solidFill></a:rPr><a:t>{}</a:t></a:r><a:endParaRPr/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="2" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1600200"/><a:ext cx="10820400" cy="4572000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1800"><a:solidFill><a:srgbClr val="333333"/></a:solidFill></a:rPr><a:t>{}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#,
        theme.primary_color.trim_start_matches('#'),
        xml_escape(heading),
        content,
    )
}

fn sd_rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>"#.to_string()
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
     .replace('"', "&quot;")
     .replace('\'', "&apos;")
}
