import { describe, expect, it } from 'vitest'
import { mealItem, totals, shoppingList, weekStart, energyGoal, mergeNutrition } from './nutrition.js'
import { queueNutrition, overlayNutrition } from './nutrition-sync.js'
import { validGTIN, decodeEAN } from './food-barcode.js'
const food={id:'milk',name:'Milk',unit:'ml',values:{energy:46,protein:3.2,carbs:null,fat:0}}
const meal=mealItem('m','Breakfast',2,[{item:food,amount:500}])
describe('nutrition',()=>{
  it('scales recipes and shopping in the original unit, with missing values distinct from zero',()=>{
    expect(meal.values).toEqual({energy:115,protein:8,carbs:null,fat:0})
    expect(totals([{item:meal,amount:1.5}]).carbs).toEqual({value:null,partial:true})
    const row={date:'2026-01-01',slot:'Breakfast',item:meal,amount:1}
    expect(weekStart(row.date)).toBe('2025-12-29')
    expect(shoppingList([row,{...row,item:food,amount:50},{...row,date:'2026-01-05'}],'2025-12-29')[0].amount).toBe(300)
  })
  it('converts pounds for the same adult estimate and ignores descriptive frame size',()=>{
    const profile={age:25,height:197,sex:'male',activity:'light',goal:'maintain'}
    expect(energyGoal(profile,109,'kg')).toEqual(energyGoal({...profile,build:'large'},109/0.45359237,'lb'))
    expect(energyGoal({...profile,age:17},109,'kg')).toBeNull()
  })
  it('merges repeated backups once and overlays pending edits on another device’s records',()=>{
    const before={foods:[food]}, changed={foods:[{...food,name:'Updated'}]}
    expect(mergeNutrition(before,before).foods).toEqual([food])
    const ops=queueNutrition(before,changed,[],'edit')
    const remote={foods:[food,{...food,id:'other'}]}
    expect(overlayNutrition(remote,ops).foods.map(f=>f.name)).toEqual(['Updated','Milk'])
    const deleted=queueNutrition(changed,{foods:[]},ops,'delete')
    expect(overlayNutrition(remote,deleted).foods.map(f=>f.id)).toEqual(['other'])
  })
  it('reads an EAN-8 scanline and rejects a bad check digit',()=>{
    // 96385074, independently encoded with GS1 L and R seven-module digits.
    const bits='0000000000'+'101'+'0001011'+'0101111'+'0111101'+'0110111'+'01010'+'1001110'+'1110010'+'1000100'+'1011100'+'101'+'0000000000'
    expect(decodeEAN([...bits].flatMap(b=>Array(3).fill(b==='1'?0:255)))).toBe('96385074')
    expect(validGTIN('96385075')).toBe(false)
    expect(validGTIN('8480000511911')).toBe(true)
  })
})

