import { describe, it, expect } from 'vitest'
import { staticData } from '../../data/static-modules'

describe('staticData', () => {
  it('exports a non-null object', () => {
    expect(staticData).toBeDefined()
    expect(typeof staticData).toBe('object')
  })

  it('contains all 14 expected modules', () => {
    const expectedModules = [
      'drugs', 'labs', 'formulas', 'strategies', 'delegation',
      'communication', 'diagnostics', 'health_equity', 'development',
      'infection_control', 'drug_suffixes', 'herbals', 'iv_fluids', 'vaccines',
    ]
    for (const mod of expectedModules) {
      expect(staticData).toHaveProperty(mod)
    }
  })

  it('each module has a _meta object', () => {
    for (const [key, mod] of Object.entries(staticData)) {
      expect(mod).toHaveProperty('_meta')
      expect((mod._meta as any).name).toBeTruthy()
      expect((mod._meta as any).version).toBe(1)
    }
  })

  describe('drugs module', () => {
    it('contains common drugs', () => {
      const drugs = staticData.drugs
      expect(drugs).toHaveProperty('metformin')
      expect(drugs).toHaveProperty('warfarin')
      expect(drugs).toHaveProperty('heparin')
      expect(drugs).toHaveProperty('digoxin')
    })

    it('drug entries have expected structure', () => {
      const metformin = staticData.drugs.metformin as any
      expect(metformin.class).toBe('Biguanide')
      expect(metformin.nclex_tip).toBeTruthy()
    })
  })

  describe('labs module', () => {
    it('contains standard lab values', () => {
      const labs = staticData.labs
      expect(labs).toHaveProperty('sodium')
      expect(labs).toHaveProperty('potassium')
      expect(labs).toHaveProperty('INR')
    })

    it('lab entries have normal ranges', () => {
      const sodium = staticData.labs.sodium as any
      expect(sodium.normal).toBe('136-145 mEq/L')
    })
  })

  describe('formulas module', () => {
    it('contains calculation formulas', () => {
      expect(staticData.formulas).toHaveProperty('iv_drip_rate')
      expect(staticData.formulas).toHaveProperty('dosage_weight')
    })
  })

  describe('infection_control module', () => {
    it('contains precaution types', () => {
      const ic = staticData.infection_control
      expect(ic).toHaveProperty('standard')
      expect(ic).toHaveProperty('contact')
      expect(ic).toHaveProperty('droplet')
      expect(ic).toHaveProperty('airborne')
      expect(ic).toHaveProperty('neutropenic')
    })
  })

  describe('vaccines module', () => {
    it('distinguishes live and inactivated vaccines', () => {
      const vaccines = staticData.vaccines
      expect(vaccines).toHaveProperty('live_vaccines')
      expect(vaccines).toHaveProperty('inactivated_vaccines')
      expect(vaccines).toHaveProperty('nclex_rules')
    })
  })
})
