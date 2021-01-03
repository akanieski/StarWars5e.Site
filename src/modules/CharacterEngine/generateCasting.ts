import { RawCharacterType, HighLevelCastingType } from '@/types/rawCharacterTypes'
import { AbilityScoresType, TechCastingType, ForceCastingType } from '@/types/completeCharacterTypes'
import { PowerType, ClassType, ArchetypeType } from '@/types/characterTypes'
import { chain, concat, get, lowerCase, reduce } from 'lodash'
import applyTweak from '@/utilities/applyTweak'

function getMultiplier (
  className: string,
  myClasses: ClassType[],
  archetypeName: string | undefined,
  myArchetypes: ArchetypeType[],
  castingType: 'Tech' | 'Force'
) {
  const myClass = myClasses.find(({ name, casterType }) => (name === className) && (casterType === castingType))
  const myArchetype = archetypeName && myArchetypes.find(
    ({ name, casterType }) => (name === archetypeName) && (casterType === castingType)
  )
  const classMultiplier = myClass ? myClass.casterRatio : 0
  return myArchetype ? myArchetype.casterRatio : classMultiplier
}

function getCastingLevel (
  rawCharacter: RawCharacterType,
  myClasses: ClassType[],
  myArchetypes: ArchetypeType[],
  castingType: 'Tech' | 'Force'
): number {
  if (
    castingType === 'Force' &&
    rawCharacter.classes.length === 1 &&
    rawCharacter.classes[0].name === 'Guardian' &&
    rawCharacter.classes[0].levels === 1
  ) return 1
  return rawCharacter.classes.reduce((acc, { name, archetype, levels }) => acc + (levels * getMultiplier(
    name,
    myClasses,
    archetype && archetype.name,
    myArchetypes,
    castingType
  ) || 0), 0)
}

function getMaxPowerLevelPotential (
  className: string,
  myClasses: ClassType[],
  archetypeName: string | undefined,
  myArchetypes: ArchetypeType[],
  castingType: 'Tech' | 'Force'
): number {
  const myClass = myClasses.find(({ name, casterType }) => (name === className) && (casterType === castingType))
  const myArchetype = archetypeName && myArchetypes.find(
    ({ name, casterType }) => (name === archetypeName) && (casterType === castingType)
  )
  if (myArchetype) {
    const leveledTable = myArchetype.leveledTable
    if (leveledTable) {
      const maxPowerLevelValue = leveledTable[20].find(({ key }) => key === 'Max Power Level')
      return maxPowerLevelValue ? parseInt(maxPowerLevelValue.value) : 0
    }
  }
  return myClass ? parseInt(myClass.levelChanges[20]['Max Power Level']) : 0
}

function getMaxPowerLevel (
  rawCharacter: RawCharacterType,
  myClasses: ClassType[],
  consular: ClassType | undefined,
  myArchetypes: ArchetypeType[],
  castingType: 'Tech' | 'Force'
) {
  let maxPower = 0
  if (rawCharacter.classes.length === 1 && rawCharacter.classes[0].name === 'Sentinel') {
    // Sentinels don't follow the multiclass rules for max power level
    maxPower = parseInt(myClasses[0].levelChanges[rawCharacter.classes[0].levels]['Max Power Level'])
  } else {
    // Use multiclass rules to determine max power level
    let maxPowerLevel = reduce(rawCharacter.classes, (acc, myClass) => {
      const potential = getMaxPowerLevelPotential(
        myClass.name,
        myClasses,
        myClass.archetype && myClass.archetype.name,
        myArchetypes,
        castingType
      )
      const levels = myClass.levels * potential / 9
      return Math.max(levels, 0) + acc
    }, 0)
    if (consular && maxPowerLevel > 0) {
      const effectiveLevel = Math.max(1, Math.floor(maxPowerLevel))
      maxPower = parseInt(consular.levelChanges[effectiveLevel]['Max Power Level'])
    }
  }
  return applyTweak(rawCharacter, lowerCase(castingType) + 'Casting.maxPowerLevel', maxPower)
}

function getPowerPoints (
  rawCharacter: RawCharacterType,
  myClasses: ClassType[],
  myArchetypes: ArchetypeType[],
  abilityBonus: number,
  castingType: 'Tech' | 'Force'
) {
  const maxPoints = rawCharacter.classes.reduce((acc, { name, archetype, levels }) => {
    const isTech = castingType === 'Tech'
    switch (getMultiplier(name, myClasses, archetype && archetype.name, myArchetypes, castingType)) {
      case 1 / 3:
        return acc + (isTech ? Math.ceil(levels / 2) : levels)
      case 1 / 2:
        return acc + levels * (isTech ? 1 : 2)
      case 2 / 3:
        return acc + levels * 3
      case 1:
        return acc + levels * (isTech ? 2 : 4)
      default:
        return acc
    }
  }, abilityBonus)
  return applyTweak(rawCharacter, lowerCase(castingType) + 'Casting.maxPoints', maxPoints)
}

function findPower (power: string, powers: PowerType[]): PowerType | undefined {
  const powerData = powers.find(({ name }) => name === power)
  if (!powerData) console.error('Warning: Power not found: ' + power)
  return powerData
}

function getPowersKnown (rawCharacter: RawCharacterType, powers: PowerType[], castingType: 'Tech' | 'Force') {
  return chain(rawCharacter.classes)
    .map(myClass => {
      const powerName = (lowerCase(castingType) + 'Powers') as 'techPowers' | 'forcePowers'
      const powerList = concat(myClass[powerName] as string[] || [], get(myClass, 'archetype.' + powerName) || [])
      return powerList.map(power => findPower(power, powers))
    })
    .concat(rawCharacter[`custom${castingType}Powers` as 'customForcePowers' | 'customTechPowers'].map(power => findPower(power, powers)))
    .flatten()
    .compact()
    .value()
}

export default function generateCasting (
  rawCharacter: RawCharacterType,
  abilityScores: AbilityScoresType,
  powers: PowerType[],
  proficiencyBonus: number,
  myClasses: ClassType[],
  consular: ClassType | undefined,
  myArchetypes: ArchetypeType[]
): {
  techCasting: false | TechCastingType,
  forceCasting: false | ForceCastingType,
  highLevelCasting: HighLevelCastingType,
  allForcePowers: string[]
} {
  const techCastingBonus = abilityScores.Intelligence.modifier
  const techCastingLevel = getCastingLevel(rawCharacter, myClasses, myArchetypes, 'Tech')
  const techCasting = {
    pointsUsed: rawCharacter.currentStats.techPointsUsed,
    maxPoints: getPowerPoints(rawCharacter, myClasses, myArchetypes, techCastingBonus, 'Tech'),
    attackModifier: applyTweak(rawCharacter, 'techCasting.attackModifier', techCastingBonus + proficiencyBonus),
    saveDC: applyTweak(rawCharacter, 'techCasting.saveDC', 8 + techCastingBonus + proficiencyBonus),
    maxPowerLevel: getMaxPowerLevel(rawCharacter, myClasses, consular, myArchetypes, 'Tech'),
    powersKnown: getPowersKnown(rawCharacter, powers, 'Tech')
  }
  const hasTechCasting = techCastingLevel >= 0.6 || techCasting.powersKnown.length > 0

  const forceCastingBonus = {
    light: abilityScores.Wisdom.modifier,
    dark: abilityScores.Charisma.modifier,
    universal: Math.max(abilityScores.Wisdom.modifier, abilityScores.Charisma.modifier)
  }
  const forceCastingLevel = getCastingLevel(rawCharacter, myClasses, myArchetypes, 'Force')
  const forcePowersKnown = getPowersKnown(rawCharacter, powers, 'Force')

  const forceCasting = {
    pointsUsed: rawCharacter.currentStats.forcePointsUsed,
    maxPoints: getPowerPoints(rawCharacter, myClasses, myArchetypes, forceCastingBonus.universal, 'Force'),
    lightAttackModifier: applyTweak(rawCharacter, 'forceCasting.lightAttackModifier', forceCastingBonus.light + proficiencyBonus),
    lightSaveDC: applyTweak(rawCharacter, 'forceCasting.lightSaveDC', 8 + forceCastingBonus.light + proficiencyBonus),
    darkAttackModifier: applyTweak(rawCharacter, 'forceCasting.darkAttackModifier', forceCastingBonus.dark + proficiencyBonus),
    darkSaveDC: applyTweak(rawCharacter, 'forceCasting.darkSaveDC', 8 + forceCastingBonus.dark + proficiencyBonus),
    universalAttackModifier: applyTweak(rawCharacter, 'forceCasting.universalAttackModifier', forceCastingBonus.universal + proficiencyBonus),
    universalSaveDC: applyTweak(rawCharacter, 'forceCasting.universalSaveDC', 8 + forceCastingBonus.universal + proficiencyBonus),
    maxPowerLevel: getMaxPowerLevel(rawCharacter, myClasses, consular, myArchetypes, 'Force'),
    powersKnown: forcePowersKnown
  }
  const hasForceCasting = forceCastingLevel >= 0.6 || forceCasting.powersKnown.length > 0
  const allForcePowers = [
    ...rawCharacter.customForcePowers,
    ...rawCharacter.classes.map(({ forcePowers }) => forcePowers || []).flat()
  ]

  return {
    highLevelCasting: rawCharacter.currentStats.highLevelCasting,
    techCasting: hasTechCasting && techCasting,
    forceCasting: hasForceCasting && forceCasting,
    allForcePowers
  }
}
