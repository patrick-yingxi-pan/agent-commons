/** Editable PresentationML built from the saved title/bullet contract only.
 * Package relationships follow Microsoft's minimum presentation structure:
 * https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document */
import { artifactExportFilename, PPTX_MEDIA_TYPE, type ArtifactPresentationExport } from '../contract/index.ts'
import { writeOfficeZip } from './artifactOfficeZip.ts'
import { hasPowerPointText, presentationPages, PRESENTATION_HEIGHT, PRESENTATION_WIDTH, type PresentationTextBox, type SlidesBody } from './artifactPptxLayout.ts'

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS = `xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"`
const FONT = 'Arial'
const INK = '283F54'
const BODY = '202A35'
const emu = (points: number) => Math.round(points * 12700)
const escapeXml = (text: string) => text.replace(/[&<>"'\r]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '\r': '&#13;' })[char]!)
const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
const COLORS = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"'
const colorMap = '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>'

function relationships(entries: Array<[string, string, string]>): string {
  return `${XML}<Relationships xmlns="${RELS}">${entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`).join('')}</Relationships>`
}

function textBox(box: PresentationTextBox, id: number): string {
  const color = box.bold ? INK : BODY
  const runProperties = `<a:rPr sz="${box.fontSize * 100}" b="${box.bold ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:rPr>`
  // Text stays in native editable runs. Literal XML characters and escape-like
  // text are not interpreted as markup, hyperlinks, fields or formulas.
  const runs = box.text.split(/(\r\n|\r|\n)/u).map((part) => /^(\r\n|\r|\n)$/u.test(part)
    ? `<a:br><a:rPr sz="${box.fontSize * 100}"/></a:br>`
    : part ? `<a:r>${runProperties}<a:t xml:space="preserve">${escapeXml(part)}</a:t></a:r>` : '').join('')
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(box.name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.width)}" cy="${emu(box.height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr marL="${box.bullet ? emu(18) : 0}" indent="${box.bullet ? -emu(18) : 0}"><a:lnSpc><a:spcPts val="${box.fontSize * 125}"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft>${box.bullet ? `<a:buFont typeface="${FONT}"/><a:buChar char="•"/>` : '<a:buNone/>'}</a:pPr>${runs}<a:endParaRPr sz="${box.fontSize * 100}"/></a:p></p:txBody></p:sp>`
}

function theme(): string {
  const colors: Array<[string, string]> = [['dk1', BODY], ['lt1', 'FFFFFF'], ['dk2', INK], ['lt2', 'F5F7FA'], ['accent1', INK], ['accent2', '9D3547'], ['accent3', '3A776C'], ['accent4', 'AC772B'], ['accent5', '665A91'], ['accent6', '527C9C'], ['hlink', '245B9E'], ['folHlink', '665A91']]
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  const font = `<a:latin typeface="${FONT}"/><a:ea typeface=""/><a:cs typeface=""/>`
  return `${XML}<a:theme xmlns:a="${A}" name="Agent Commons"><a:themeElements><a:clrScheme name="Agent Commons">${colors.map(([name, value]) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`).join('')}</a:clrScheme><a:fontScheme name="Agent Commons"><a:majorFont>${font}</a:majorFont><a:minorFont>${font}</a:minorFont></a:fontScheme><a:fmtScheme name="Agent Commons"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[9525, 25400, 38100].map((width) => `<a:ln w="${width}" cap="flat" cmpd="sng" algn="ctr">${fill}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`).join('')}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
}

export async function slidesPptx(name: string, body: SlidesBody): Promise<Omit<ArtifactPresentationExport, 'artifactId'>> {
  if (!hasPowerPointText(body)) throw new Error('Saved text contains characters that XML cannot represent')
  const pages = presentationPages(body)
  const types: Array<[string, string]> = [
    ['ppt/presentation.xml', 'presentation.main'], ['ppt/presProps.xml', 'presProps'],
    ['ppt/slideMasters/slideMaster1.xml', 'slideMaster'], ['ppt/slideLayouts/slideLayout1.xml', 'slideLayout'],
    ...pages.map((_page, index): [string, string] => [`ppt/slides/slide${index + 1}.xml`, 'slide']),
  ]
  const parts: Array<[string, string]> = [
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${types.map(([path, type]) => `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}+xml"/>`).join('')}<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`],
    ['_rels/.rels', relationships([['rId1', 'officeDocument', 'ppt/presentation.xml']])],
    ['ppt/presentation.xml', `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${pages.map((_page, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${emu(PRESENTATION_WIDTH)}" cy="${emu(PRESENTATION_HEIGHT)}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', relationships([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'presProps', 'presProps.xml'], ...pages.map((_page, index): [string, string, string] => [`rId${index + 3}`, 'slide', `slides/slide${index + 1}.xml`])])],
    ['ppt/presProps.xml', `${XML}<p:presentationPr ${NS}/>`],
    ['ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMap ${COLORS}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', relationships([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']])],
    ['ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld>${colorMap}</p:sldLayout>`],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', relationships([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])],
    ['ppt/theme/theme1.xml', theme()],
  ]
  pages.forEach((page, index) => {
    const marker: PresentationTextBox = { name: 'Source slide', text: `${page.sourceSlide}${page.part > 1 ? ` · continued ${page.part}` : ''}`, x: 54, y: 510, width: 852, height: 20, fontSize: 12, bold: false, bullet: false }
    parts.push([`ppt/slides/slide${index + 1}.xml`, `${XML}<p:sld ${NS}><p:cSld name="Slide ${page.sourceSlide}, part ${page.part}"><p:spTree>${GROUP}${[...page.boxes, marker].map((box, i) => textBox(box, i + 2)).join('')}</p:spTree></p:cSld>${colorMap}</p:sld>`])
    parts.push([`ppt/slides/_rels/slide${index + 1}.xml.rels`, relationships([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']])])
  })
  const bytes = await writeOfficeZip(parts)
  return { filename: artifactExportFilename(name, 'pptx'), mediaType: PPTX_MEDIA_TYPE, encoding: 'base64', content: Buffer.from(bytes).toString('base64'), revision: body.revision ?? 0 }
}
