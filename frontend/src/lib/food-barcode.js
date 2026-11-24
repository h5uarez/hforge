export function validGTIN(code) {
  if (!/^(?:\d{8}|\d{12,14})$/.test(code)) return false
  let sum = 0
  for (let i=code.length-1, weight=1; i>=0; i--, weight=4-weight) sum += Number(code[i])*weight
  return sum % 10 === 0
}

// EAN symbols use four alternating runs for each seven-module digit.
const left = ['3211','2221','2122','1411','1132','1231','1114','1312','1213','3112']
const parity = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']
function digit(runs, offset, allowG) {
  const part = runs.slice(offset,offset+4)
  const scale = part.reduce((a,b)=>a+b,0)/7
  let best = null, error = 0.95
  for (let n=0;n<10;n++) for (const kind of (allowG ? ['L','G'] : ['L'])) {
    const pattern = kind === 'L' ? left[n] : [...left[n]].reverse().join('')
    const diff = part.reduce((s,width,i)=>s+(width/scale-Number(pattern[i]))**2,0)
    if (diff < error) { best={n,kind}; error=diff }
  }
  return best
}
export function decodeEAN(line) {
  let lo=255,hi=0
  for (const v of line) {lo=Math.min(lo,v);hi=Math.max(hi,v)}
  if (hi-lo<32) return null
  const runs=[], threshold=(lo+hi)/2
  let dark=false, width=0
  for (const v of line) {
    if ((v<threshold) !== dark) {runs.push(width);width=0;dark=!dark}
    width++
  }
  runs.push(width)
  for (let start=1;start+42<=runs.length;start+=2) {
    for (const count of [6,4]) {
      const mid=start+3+4*count, end=mid+5+4*count
      if (end+3>runs.length) continue
      const scale=(runs[start]+runs[start+1]+runs[start+2])/3
      if (runs[start-1] < scale*3) continue
      if (![start,start+1,start+2,mid,mid+1,mid+2,mid+3,mid+4,end,end+1,end+2].every(i=>Math.abs(runs[i]/scale-1)<0.7)) continue
      const a=[],b=[]
      for(let i=0;i<count;i++) {a.push(digit(runs,start+3+i*4,count===6));b.push(digit(runs,mid+5+i*4,false))}
      if ([...a,...b].some(v=>!v)) continue
      const lead=count===6 ? parity.indexOf(a.map(v=>v.kind).join('')) : ''
      if (lead===-1) continue
      const code=String(lead)+[...a,...b].map(v=>v.n).join('')
      if (validGTIN(code)) return code
    }
  }
  return null
}
export async function barcodeFromPhoto(file) {
  const url=URL.createObjectURL(file)
  try {
    const img=new Image()
    img.src=url
    await img.decode()
    if (typeof BarcodeDetector !== 'undefined') {
      try {
        const matches=await new BarcodeDetector().detect(img)
        const found=matches.find(m=>validGTIN(m.rawValue))
        if (found) return found.rawValue
      } catch { /* Continue with the local EAN reader. */ }
    }
    const ratio=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight))
    const canvas=document.createElement('canvas')
    canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio))
    canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio))
    const ctx=canvas.getContext('2d',{willReadFrequently:true})
    ctx.drawImage(img,0,0,canvas.width,canvas.height)
    const {data}=ctx.getImageData(0,0,canvas.width,canvas.height)
    const hits=new Map()
    for (const vertical of [false,true]) {
      const length=vertical?canvas.height:canvas.width, cross=vertical?canvas.width:canvas.height
      for (let step=2;step<=38;step++) {
        const fixed=Math.min(cross-1,Math.floor(cross*step/40)), line=new Uint8Array(length)
        for(let i=0;i<length;i++){
          const p=4*(vertical ? i*canvas.width+fixed : fixed*canvas.width+i)
          line[i]=(data[p]+2*data[p+1]+data[p+2])/4
        }
        const code=decodeEAN(line)||decodeEAN(line.reverse())
        if(code && hits.has(code)) return code
        if(code) hits.set(code,true)
      }
    }
    return null
  } finally {URL.revokeObjectURL(url)}
}
export async function lookupFood(code, signal) {
  const fields='code,product_name,product_name_es,brands,nutriments,nutrition_data_per'
  const response=await fetch('https://world.openfoodfacts.org/api/v3.0/product/'+code+'.json?fields='+fields,{signal,credentials:'omit'})
  if (response.status===404) return null
  if (!response.ok) throw new Error('lookup')
  const data=await response.json()
  if (!data.product) return null
  const p=data.product, n=p.nutriments || {}
  const read=k=>n[k] == null || n[k] === '' || !Number.isFinite(Number(n[k])) || Number(n[k])<0 ? '' : String(n[k])
  return { name:[p.product_name_es || p.product_name,p.brands].filter(Boolean).join(' · ').slice(0,160),
    unit:p.nutrition_data_per==='100ml'?'ml':'g', barcode:code, source:'off',
    values:{ energy:read('energy-kcal_100g'), protein:read('proteins_100g'), carbs:read('carbohydrates_100g'), fat:read('fat_100g') } }
}

