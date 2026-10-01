// Sunrise and sunset from the NOAA solar calculator equations
// (https://gml.noaa.gov/grad/solcalc/calcdetails.html), evaluated once at
// local solar noon. Accurate to about a minute at Manipal's latitude, which
// is plenty for a "daylight outings only" limit. No network call needed.

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Julian Day Number at 0h UT for a Gregorian calendar date. */
function julianDay(year: number, month: number, day: number): number {
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;
}

export interface SunTimes {
  /** Minutes after local midnight. */
  sunriseMin: number;
  sunsetMin: number;
  solarNoonMin: number;
}

interface SolarParams {
  declDeg: number;
  eqTimeMin: number;
}

/** Sun declination and equation of time at a Julian Day. */
function solarParams(jd: number): SolarParams {
  const t = (jd - 2451545) / 36525; // Julian centuries since J2000
  const meanLong = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const ecc = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const center =
    Math.sin(rad(meanAnom)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * meanAnom)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * meanAnom)) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const appLong = meanLong + center - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(rad(omega));
  const declDeg = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(appLong))));

  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqTimeMin =
    4 *
    deg(
      y * Math.sin(2 * rad(meanLong)) -
        2 * ecc * Math.sin(rad(meanAnom)) +
        4 * ecc * y * Math.sin(rad(meanAnom)) * Math.cos(2 * rad(meanLong)) -
        0.5 * y * y * Math.sin(4 * rad(meanLong)) -
        1.25 * ecc * ecc * Math.sin(2 * rad(meanAnom)),
    );
  return { declDeg, eqTimeMin };
}

/** Hour angle (degrees) at which the sun's centre is 90.833° from the zenith. */
function hourAngleDeg(lat: number, declDeg: number): number | null {
  // 90.833° accounts for atmospheric refraction and the sun's radius.
  const cosHa =
    Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(rad(declDeg))) -
    Math.tan(rad(lat)) * Math.tan(rad(declDeg));
  if (cosHa < -1 || cosHa > 1) return null;
  return deg(Math.acos(cosHa));
}

/**
 * @param tzOffsetMin offset of the local clock from UTC, e.g. 330 for IST.
 * Returns null during polar day or night (never happens in India).
 */
export function sunTimes(
  year: number,
  month: number,
  day: number,
  lat: number,
  lng: number,
  tzOffsetMin: number,
): SunTimes | null {
  const jdMidnightLocal = julianDay(year, month, day) - tzOffsetMin / 1440;
  const noonParams = solarParams(jdMidnightLocal + 0.5);
  const solarNoonMin = 720 - 4 * lng - noonParams.eqTimeMin + tzOffsetMin;

  // Estimate each event from noon values, then re-evaluate the sun's position
  // at that estimated time. One refinement pass is enough for minute accuracy.
  const event = (sign: 1 | -1): number | null => {
    let minutes = solarNoonMin;
    let params = noonParams;
    for (let pass = 0; pass < 2; pass++) {
      const ha = hourAngleDeg(lat, params.declDeg);
      if (ha === null) return null;
      minutes = 720 - 4 * lng - params.eqTimeMin + tzOffsetMin + sign * 4 * ha;
      params = solarParams(jdMidnightLocal + minutes / 1440);
    }
    return minutes;
  };

  const sunriseMin = event(-1);
  const sunsetMin = event(1);
  if (sunriseMin === null || sunsetMin === null) return null;
  return { sunriseMin, sunsetMin, solarNoonMin };
}
