import { MatchPhase } from '../../domain/match.entity';

export interface FixtureMatch {
  matchNumber: number;
  phase: MatchPhase;
  group?: string;
  homeTeam: string;
  awayTeam: string;
  stadium: string;
  city: string;
  /** Kickoff in ISO 8601 with local offset so it parses to the correct UTC instant. */
  date: string;
}

/**
 * Official FIFA World Cup 2026 fixture (Canada / Mexico / USA).
 * Source: Wikipedia "2026 FIFA World Cup" (final draw, December 2025).
 *
 * Group stage (matches 1-72) lists the real teams. Knockout matches (73-104)
 * use placeholders (e.g. "2A" = runner-up Group A, "W73" = winner of match 73,
 * "3 A/B/C/D/F" = best third-place from those groups, "P101" = loser of match 101)
 * since the participating teams are only known once earlier rounds finish.
 */
export const WORLD_CUP_2026_FIXTURE: FixtureMatch[] = [
  // ---------------- Group stage ----------------
  // Group A
  { matchNumber: 1, phase: MatchPhase.GRUPOS, group: 'A', homeTeam: 'México', awayTeam: 'Sudáfrica', stadium: 'Estadio Azteca', city: 'Ciudad de México', date: '2026-06-11T13:00:00-06:00' },
  { matchNumber: 2, phase: MatchPhase.GRUPOS, group: 'A', homeTeam: 'Corea del Sur', awayTeam: 'República Checa', stadium: 'Estadio Akron', city: 'Zapopan', date: '2026-06-11T20:00:00-06:00' },
  { matchNumber: 25, phase: MatchPhase.GRUPOS, group: 'A', homeTeam: 'República Checa', awayTeam: 'Sudáfrica', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', date: '2026-06-18T12:00:00-04:00' },
  { matchNumber: 28, phase: MatchPhase.GRUPOS, group: 'A', homeTeam: 'México', awayTeam: 'Corea del Sur', stadium: 'Estadio Akron', city: 'Zapopan', date: '2026-06-18T19:00:00-06:00' },
  { matchNumber: 53, phase: MatchPhase.GRUPOS, group: 'A', homeTeam: 'República Checa', awayTeam: 'México', stadium: 'Estadio Azteca', city: 'Ciudad de México', date: '2026-06-24T19:00:00-06:00' },
  { matchNumber: 54, phase: MatchPhase.GRUPOS, group: 'A', homeTeam: 'Sudáfrica', awayTeam: 'Corea del Sur', stadium: 'Estadio BBVA', city: 'Guadalupe', date: '2026-06-24T19:00:00-06:00' },
  // Group B
  { matchNumber: 3, phase: MatchPhase.GRUPOS, group: 'B', homeTeam: 'Canadá', awayTeam: 'Bosnia y Herzegovina', stadium: 'BMO Field', city: 'Toronto', date: '2026-06-12T15:00:00-04:00' },
  { matchNumber: 8, phase: MatchPhase.GRUPOS, group: 'B', homeTeam: 'Catar', awayTeam: 'Suiza', stadium: "Levi's Stadium", city: 'Santa Clara', date: '2026-06-13T12:00:00-07:00' },
  { matchNumber: 26, phase: MatchPhase.GRUPOS, group: 'B', homeTeam: 'Suiza', awayTeam: 'Bosnia y Herzegovina', stadium: 'SoFi Stadium', city: 'Inglewood', date: '2026-06-18T12:00:00-07:00' },
  { matchNumber: 27, phase: MatchPhase.GRUPOS, group: 'B', homeTeam: 'Canadá', awayTeam: 'Catar', stadium: 'BC Place', city: 'Vancouver', date: '2026-06-18T15:00:00-07:00' },
  { matchNumber: 51, phase: MatchPhase.GRUPOS, group: 'B', homeTeam: 'Suiza', awayTeam: 'Canadá', stadium: 'BC Place', city: 'Vancouver', date: '2026-06-24T12:00:00-07:00' },
  { matchNumber: 52, phase: MatchPhase.GRUPOS, group: 'B', homeTeam: 'Bosnia y Herzegovina', awayTeam: 'Catar', stadium: 'Lumen Field', city: 'Seattle', date: '2026-06-24T12:00:00-07:00' },
  // Group C
  { matchNumber: 7, phase: MatchPhase.GRUPOS, group: 'C', homeTeam: 'Brasil', awayTeam: 'Marruecos', stadium: 'MetLife Stadium', city: 'East Rutherford', date: '2026-06-13T18:00:00-04:00' },
  { matchNumber: 5, phase: MatchPhase.GRUPOS, group: 'C', homeTeam: 'Haití', awayTeam: 'Escocia', stadium: 'Gillette Stadium', city: 'Foxborough', date: '2026-06-13T21:00:00-04:00' },
  { matchNumber: 30, phase: MatchPhase.GRUPOS, group: 'C', homeTeam: 'Escocia', awayTeam: 'Marruecos', stadium: 'Gillette Stadium', city: 'Foxborough', date: '2026-06-19T18:00:00-04:00' },
  { matchNumber: 29, phase: MatchPhase.GRUPOS, group: 'C', homeTeam: 'Brasil', awayTeam: 'Haití', stadium: 'Lincoln Financial Field', city: 'Filadelfia', date: '2026-06-19T20:30:00-04:00' },
  { matchNumber: 49, phase: MatchPhase.GRUPOS, group: 'C', homeTeam: 'Escocia', awayTeam: 'Brasil', stadium: 'Hard Rock Stadium', city: 'Miami Gardens', date: '2026-06-24T18:00:00-04:00' },
  { matchNumber: 50, phase: MatchPhase.GRUPOS, group: 'C', homeTeam: 'Marruecos', awayTeam: 'Haití', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', date: '2026-06-24T18:00:00-04:00' },
  // Group D
  { matchNumber: 4, phase: MatchPhase.GRUPOS, group: 'D', homeTeam: 'Estados Unidos', awayTeam: 'Paraguay', stadium: 'SoFi Stadium', city: 'Inglewood', date: '2026-06-12T18:00:00-07:00' },
  { matchNumber: 6, phase: MatchPhase.GRUPOS, group: 'D', homeTeam: 'Australia', awayTeam: 'Turquía', stadium: 'BC Place', city: 'Vancouver', date: '2026-06-13T21:00:00-07:00' },
  { matchNumber: 32, phase: MatchPhase.GRUPOS, group: 'D', homeTeam: 'Estados Unidos', awayTeam: 'Australia', stadium: 'Lumen Field', city: 'Seattle', date: '2026-06-19T12:00:00-07:00' },
  { matchNumber: 31, phase: MatchPhase.GRUPOS, group: 'D', homeTeam: 'Turquía', awayTeam: 'Paraguay', stadium: "Levi's Stadium", city: 'Santa Clara', date: '2026-06-19T20:00:00-07:00' },
  { matchNumber: 59, phase: MatchPhase.GRUPOS, group: 'D', homeTeam: 'Turquía', awayTeam: 'Estados Unidos', stadium: 'SoFi Stadium', city: 'Inglewood', date: '2026-06-25T19:00:00-07:00' },
  { matchNumber: 60, phase: MatchPhase.GRUPOS, group: 'D', homeTeam: 'Paraguay', awayTeam: 'Australia', stadium: "Levi's Stadium", city: 'Santa Clara', date: '2026-06-25T19:00:00-07:00' },
  // Group E
  { matchNumber: 10, phase: MatchPhase.GRUPOS, group: 'E', homeTeam: 'Alemania', awayTeam: 'Curazao', stadium: 'NRG Stadium', city: 'Houston', date: '2026-06-14T12:00:00-05:00' },
  { matchNumber: 9, phase: MatchPhase.GRUPOS, group: 'E', homeTeam: 'Costa de Marfil', awayTeam: 'Ecuador', stadium: 'Lincoln Financial Field', city: 'Filadelfia', date: '2026-06-14T19:00:00-04:00' },
  { matchNumber: 33, phase: MatchPhase.GRUPOS, group: 'E', homeTeam: 'Alemania', awayTeam: 'Costa de Marfil', stadium: 'BMO Field', city: 'Toronto', date: '2026-06-20T16:00:00-04:00' },
  { matchNumber: 34, phase: MatchPhase.GRUPOS, group: 'E', homeTeam: 'Ecuador', awayTeam: 'Curazao', stadium: 'Arrowhead Stadium', city: 'Kansas City', date: '2026-06-20T19:00:00-05:00' },
  { matchNumber: 55, phase: MatchPhase.GRUPOS, group: 'E', homeTeam: 'Curazao', awayTeam: 'Costa de Marfil', stadium: 'Lincoln Financial Field', city: 'Filadelfia', date: '2026-06-25T16:00:00-04:00' },
  { matchNumber: 56, phase: MatchPhase.GRUPOS, group: 'E', homeTeam: 'Ecuador', awayTeam: 'Alemania', stadium: 'MetLife Stadium', city: 'East Rutherford', date: '2026-06-25T16:00:00-04:00' },
  // Group F
  { matchNumber: 11, phase: MatchPhase.GRUPOS, group: 'F', homeTeam: 'Países Bajos', awayTeam: 'Japón', stadium: 'AT&T Stadium', city: 'Arlington', date: '2026-06-14T15:00:00-05:00' },
  { matchNumber: 12, phase: MatchPhase.GRUPOS, group: 'F', homeTeam: 'Suecia', awayTeam: 'Túnez', stadium: 'Estadio BBVA', city: 'Guadalupe', date: '2026-06-14T20:00:00-06:00' },
  { matchNumber: 35, phase: MatchPhase.GRUPOS, group: 'F', homeTeam: 'Países Bajos', awayTeam: 'Suecia', stadium: 'NRG Stadium', city: 'Houston', date: '2026-06-20T12:00:00-05:00' },
  { matchNumber: 36, phase: MatchPhase.GRUPOS, group: 'F', homeTeam: 'Túnez', awayTeam: 'Japón', stadium: 'Estadio BBVA', city: 'Guadalupe', date: '2026-06-20T22:00:00-06:00' },
  { matchNumber: 57, phase: MatchPhase.GRUPOS, group: 'F', homeTeam: 'Japón', awayTeam: 'Suecia', stadium: 'AT&T Stadium', city: 'Arlington', date: '2026-06-25T18:00:00-05:00' },
  { matchNumber: 58, phase: MatchPhase.GRUPOS, group: 'F', homeTeam: 'Túnez', awayTeam: 'Países Bajos', stadium: 'Arrowhead Stadium', city: 'Kansas City', date: '2026-06-25T18:00:00-05:00' },
  // Group G
  { matchNumber: 16, phase: MatchPhase.GRUPOS, group: 'G', homeTeam: 'Bélgica', awayTeam: 'Egipto', stadium: 'Lumen Field', city: 'Seattle', date: '2026-06-15T12:00:00-07:00' },
  { matchNumber: 15, phase: MatchPhase.GRUPOS, group: 'G', homeTeam: 'Irán', awayTeam: 'Nueva Zelanda', stadium: 'SoFi Stadium', city: 'Inglewood', date: '2026-06-15T18:00:00-07:00' },
  { matchNumber: 39, phase: MatchPhase.GRUPOS, group: 'G', homeTeam: 'Bélgica', awayTeam: 'Irán', stadium: 'SoFi Stadium', city: 'Inglewood', date: '2026-06-21T12:00:00-07:00' },
  { matchNumber: 40, phase: MatchPhase.GRUPOS, group: 'G', homeTeam: 'Nueva Zelanda', awayTeam: 'Egipto', stadium: 'BC Place', city: 'Vancouver', date: '2026-06-21T18:00:00-07:00' },
  { matchNumber: 63, phase: MatchPhase.GRUPOS, group: 'G', homeTeam: 'Egipto', awayTeam: 'Irán', stadium: 'Lumen Field', city: 'Seattle', date: '2026-06-26T20:00:00-07:00' },
  { matchNumber: 64, phase: MatchPhase.GRUPOS, group: 'G', homeTeam: 'Nueva Zelanda', awayTeam: 'Bélgica', stadium: 'BC Place', city: 'Vancouver', date: '2026-06-26T20:00:00-07:00' },
  // Group H
  { matchNumber: 14, phase: MatchPhase.GRUPOS, group: 'H', homeTeam: 'España', awayTeam: 'Cabo Verde', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', date: '2026-06-15T12:00:00-04:00' },
  { matchNumber: 13, phase: MatchPhase.GRUPOS, group: 'H', homeTeam: 'Arabia Saudita', awayTeam: 'Uruguay', stadium: 'Hard Rock Stadium', city: 'Miami Gardens', date: '2026-06-15T18:00:00-04:00' },
  { matchNumber: 38, phase: MatchPhase.GRUPOS, group: 'H', homeTeam: 'España', awayTeam: 'Arabia Saudita', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', date: '2026-06-21T12:00:00-04:00' },
  { matchNumber: 37, phase: MatchPhase.GRUPOS, group: 'H', homeTeam: 'Uruguay', awayTeam: 'Cabo Verde', stadium: 'Hard Rock Stadium', city: 'Miami Gardens', date: '2026-06-21T18:00:00-04:00' },
  { matchNumber: 65, phase: MatchPhase.GRUPOS, group: 'H', homeTeam: 'Cabo Verde', awayTeam: 'Arabia Saudita', stadium: 'NRG Stadium', city: 'Houston', date: '2026-06-26T19:00:00-05:00' },
  { matchNumber: 66, phase: MatchPhase.GRUPOS, group: 'H', homeTeam: 'Uruguay', awayTeam: 'España', stadium: 'Estadio Akron', city: 'Zapopan', date: '2026-06-26T18:00:00-06:00' },
  // Group I
  { matchNumber: 17, phase: MatchPhase.GRUPOS, group: 'I', homeTeam: 'Francia', awayTeam: 'Senegal', stadium: 'MetLife Stadium', city: 'East Rutherford', date: '2026-06-16T15:00:00-04:00' },
  { matchNumber: 18, phase: MatchPhase.GRUPOS, group: 'I', homeTeam: 'Irak', awayTeam: 'Noruega', stadium: 'Gillette Stadium', city: 'Foxborough', date: '2026-06-16T18:00:00-04:00' },
  { matchNumber: 42, phase: MatchPhase.GRUPOS, group: 'I', homeTeam: 'Francia', awayTeam: 'Irak', stadium: 'Lincoln Financial Field', city: 'Filadelfia', date: '2026-06-22T17:00:00-04:00' },
  { matchNumber: 41, phase: MatchPhase.GRUPOS, group: 'I', homeTeam: 'Noruega', awayTeam: 'Senegal', stadium: 'MetLife Stadium', city: 'East Rutherford', date: '2026-06-22T20:00:00-04:00' },
  { matchNumber: 61, phase: MatchPhase.GRUPOS, group: 'I', homeTeam: 'Noruega', awayTeam: 'Francia', stadium: 'Gillette Stadium', city: 'Foxborough', date: '2026-06-26T15:00:00-04:00' },
  { matchNumber: 62, phase: MatchPhase.GRUPOS, group: 'I', homeTeam: 'Senegal', awayTeam: 'Irak', stadium: 'BMO Field', city: 'Toronto', date: '2026-06-26T15:00:00-04:00' },
  // Group J
  { matchNumber: 19, phase: MatchPhase.GRUPOS, group: 'J', homeTeam: 'Argentina', awayTeam: 'Argelia', stadium: 'Arrowhead Stadium', city: 'Kansas City', date: '2026-06-16T20:00:00-05:00' },
  { matchNumber: 20, phase: MatchPhase.GRUPOS, group: 'J', homeTeam: 'Austria', awayTeam: 'Jordania', stadium: "Levi's Stadium", city: 'Santa Clara', date: '2026-06-16T21:00:00-07:00' },
  { matchNumber: 43, phase: MatchPhase.GRUPOS, group: 'J', homeTeam: 'Argentina', awayTeam: 'Austria', stadium: 'AT&T Stadium', city: 'Arlington', date: '2026-06-22T12:00:00-05:00' },
  { matchNumber: 44, phase: MatchPhase.GRUPOS, group: 'J', homeTeam: 'Jordania', awayTeam: 'Argelia', stadium: "Levi's Stadium", city: 'Santa Clara', date: '2026-06-22T20:00:00-07:00' },
  { matchNumber: 69, phase: MatchPhase.GRUPOS, group: 'J', homeTeam: 'Argelia', awayTeam: 'Austria', stadium: 'Arrowhead Stadium', city: 'Kansas City', date: '2026-06-27T21:00:00-05:00' },
  { matchNumber: 70, phase: MatchPhase.GRUPOS, group: 'J', homeTeam: 'Jordania', awayTeam: 'Argentina', stadium: 'AT&T Stadium', city: 'Arlington', date: '2026-06-27T21:00:00-05:00' },
  // Group K
  { matchNumber: 23, phase: MatchPhase.GRUPOS, group: 'K', homeTeam: 'Portugal', awayTeam: 'RD Congo', stadium: 'NRG Stadium', city: 'Houston', date: '2026-06-17T12:00:00-05:00' },
  { matchNumber: 24, phase: MatchPhase.GRUPOS, group: 'K', homeTeam: 'Uzbekistán', awayTeam: 'Colombia', stadium: 'Estadio Azteca', city: 'Ciudad de México', date: '2026-06-17T20:00:00-06:00' },
  { matchNumber: 47, phase: MatchPhase.GRUPOS, group: 'K', homeTeam: 'Portugal', awayTeam: 'Uzbekistán', stadium: 'NRG Stadium', city: 'Houston', date: '2026-06-23T12:00:00-05:00' },
  { matchNumber: 48, phase: MatchPhase.GRUPOS, group: 'K', homeTeam: 'Colombia', awayTeam: 'RD Congo', stadium: 'Estadio Akron', city: 'Zapopan', date: '2026-06-23T20:00:00-06:00' },
  { matchNumber: 71, phase: MatchPhase.GRUPOS, group: 'K', homeTeam: 'Colombia', awayTeam: 'Portugal', stadium: 'Hard Rock Stadium', city: 'Miami Gardens', date: '2026-06-27T19:30:00-04:00' },
  { matchNumber: 72, phase: MatchPhase.GRUPOS, group: 'K', homeTeam: 'RD Congo', awayTeam: 'Uzbekistán', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', date: '2026-06-27T19:30:00-04:00' },
  // Group L
  { matchNumber: 22, phase: MatchPhase.GRUPOS, group: 'L', homeTeam: 'Inglaterra', awayTeam: 'Croacia', stadium: 'AT&T Stadium', city: 'Arlington', date: '2026-06-17T15:00:00-05:00' },
  { matchNumber: 21, phase: MatchPhase.GRUPOS, group: 'L', homeTeam: 'Ghana', awayTeam: 'Panamá', stadium: 'BMO Field', city: 'Toronto', date: '2026-06-17T19:00:00-04:00' },
  { matchNumber: 45, phase: MatchPhase.GRUPOS, group: 'L', homeTeam: 'Inglaterra', awayTeam: 'Ghana', stadium: 'Gillette Stadium', city: 'Foxborough', date: '2026-06-23T16:00:00-04:00' },
  { matchNumber: 46, phase: MatchPhase.GRUPOS, group: 'L', homeTeam: 'Panamá', awayTeam: 'Croacia', stadium: 'BMO Field', city: 'Toronto', date: '2026-06-23T19:00:00-04:00' },
  { matchNumber: 67, phase: MatchPhase.GRUPOS, group: 'L', homeTeam: 'Panamá', awayTeam: 'Inglaterra', stadium: 'MetLife Stadium', city: 'East Rutherford', date: '2026-06-27T17:00:00-04:00' },
  { matchNumber: 68, phase: MatchPhase.GRUPOS, group: 'L', homeTeam: 'Croacia', awayTeam: 'Ghana', stadium: 'Lincoln Financial Field', city: 'Filadelfia', date: '2026-06-27T17:00:00-04:00' },

  // ---------------- Round of 32 (dieciseisavos) ----------------
  { matchNumber: 73, phase: MatchPhase.DIECISEISAVOS, homeTeam: 'Sudáfrica', awayTeam: 'Canadá', stadium: 'SoFi Stadium', city: 'Inglewood', date: '2026-06-28T12:00:00-07:00' },
  { matchNumber: 74, phase: MatchPhase.DIECISEISAVOS, homeTeam: 'Alemania', awayTeam: 'Paraguay', stadium: 'Gillette Stadium', city: 'Foxborough', date: '2026-06-29T16:30:00-04:00' },
  { matchNumber: 75, phase: MatchPhase.DIECISEISAVOS, homeTeam: 'Países Bajos', awayTeam: 'Marruecos', stadium: 'Estadio BBVA', city: 'Guadalupe', date: '2026-06-29T19:00:00-06:00' },
  { matchNumber: 76, phase: MatchPhase.DIECISEISAVOS, homeTeam: 'Brasil', awayTeam: 'Japón', stadium: 'NRG Stadium', city: 'Houston', date: '2026-06-29T12:00:00-05:00' },
  { matchNumber: 77, phase: MatchPhase.DIECISEISAVOS, homeTeam: 'Francia', awayTeam: 'Suecia', stadium: 'MetLife Stadium', city: 'East Rutherford', date: '2026-06-30T17:00:00-04:00' },
  { matchNumber: 78, phase: MatchPhase.DIECISEISAVOS, homeTeam: 'Costa de Marfil', awayTeam: 'Noruega', stadium: 'AT&T Stadium', city: 'Arlington', date: '2026-06-30T12:00:00-05:00' },
  { matchNumber: 79, phase: MatchPhase.DIECISEISAVOS, homeTeam: 'México', awayTeam: '3.º Grupo C/E/F/H/I', stadium: 'Estadio Azteca', city: 'Ciudad de México', date: '2026-06-30T19:00:00-06:00' },
  { matchNumber: 80, phase: MatchPhase.DIECISEISAVOS, homeTeam: '1.º Grupo L', awayTeam: '3.º Grupo E/H/I/J/K', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', date: '2026-07-01T12:00:00-04:00' },
  { matchNumber: 81, phase: MatchPhase.DIECISEISAVOS, homeTeam: 'Estados Unidos', awayTeam: 'Bosnia y Herzegovina', stadium: "Levi's Stadium", city: 'Santa Clara', date: '2026-07-01T17:00:00-07:00' },
  { matchNumber: 82, phase: MatchPhase.DIECISEISAVOS, homeTeam: 'Bélgica', awayTeam: '3.º Grupo A/E/H/I/J', stadium: 'Lumen Field', city: 'Seattle', date: '2026-07-01T13:00:00-07:00' },
  { matchNumber: 83, phase: MatchPhase.DIECISEISAVOS, homeTeam: '2.º Grupo K', awayTeam: '2.º Grupo L', stadium: 'BMO Field', city: 'Toronto', date: '2026-07-02T19:00:00-04:00' },
  { matchNumber: 84, phase: MatchPhase.DIECISEISAVOS, homeTeam: 'España', awayTeam: '2.º Grupo J', stadium: 'SoFi Stadium', city: 'Inglewood', date: '2026-07-02T12:00:00-07:00' },
  { matchNumber: 85, phase: MatchPhase.DIECISEISAVOS, homeTeam: 'Suiza', awayTeam: '3.º Grupo E/F/G/I/J', stadium: 'BC Place', city: 'Vancouver', date: '2026-07-02T20:00:00-07:00' },
  { matchNumber: 86, phase: MatchPhase.DIECISEISAVOS, homeTeam: 'Argentina', awayTeam: 'Cabo Verde', stadium: 'Hard Rock Stadium', city: 'Miami Gardens', date: '2026-07-03T18:00:00-04:00' },
  { matchNumber: 87, phase: MatchPhase.DIECISEISAVOS, homeTeam: '1.º Grupo K', awayTeam: '3.º Grupo D/E/I/J/L', stadium: 'Arrowhead Stadium', city: 'Kansas City', date: '2026-07-03T20:30:00-05:00' },
  { matchNumber: 88, phase: MatchPhase.DIECISEISAVOS, homeTeam: 'Australia', awayTeam: 'Egipto', stadium: 'AT&T Stadium', city: 'Arlington', date: '2026-07-03T13:00:00-05:00' },

  // ---------------- Round of 16 (octavos) ----------------
  { matchNumber: 89, phase: MatchPhase.OCTAVOS, homeTeam: 'Ganador P74', awayTeam: 'Ganador P77', stadium: 'Lincoln Financial Field', city: 'Filadelfia', date: '2026-07-04T17:00:00-04:00' },
  { matchNumber: 90, phase: MatchPhase.OCTAVOS, homeTeam: 'Ganador P73', awayTeam: 'Ganador P75', stadium: 'NRG Stadium', city: 'Houston', date: '2026-07-04T12:00:00-05:00' },
  { matchNumber: 91, phase: MatchPhase.OCTAVOS, homeTeam: 'Ganador P76', awayTeam: 'Ganador P78', stadium: 'MetLife Stadium', city: 'East Rutherford', date: '2026-07-05T16:00:00-04:00' },
  { matchNumber: 92, phase: MatchPhase.OCTAVOS, homeTeam: 'Ganador P79', awayTeam: 'Ganador P80', stadium: 'Estadio Azteca', city: 'Ciudad de México', date: '2026-07-05T18:00:00-06:00' },
  { matchNumber: 93, phase: MatchPhase.OCTAVOS, homeTeam: 'Ganador P83', awayTeam: 'Ganador P84', stadium: 'AT&T Stadium', city: 'Arlington', date: '2026-07-06T14:00:00-05:00' },
  { matchNumber: 94, phase: MatchPhase.OCTAVOS, homeTeam: 'Ganador P81', awayTeam: 'Ganador P82', stadium: 'Lumen Field', city: 'Seattle', date: '2026-07-06T17:00:00-07:00' },
  { matchNumber: 95, phase: MatchPhase.OCTAVOS, homeTeam: 'Ganador P86', awayTeam: 'Ganador P88', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', date: '2026-07-07T12:00:00-04:00' },
  { matchNumber: 96, phase: MatchPhase.OCTAVOS, homeTeam: 'Ganador P85', awayTeam: 'Ganador P87', stadium: 'BC Place', city: 'Vancouver', date: '2026-07-07T13:00:00-07:00' },

  // ---------------- Quarterfinals (cuartos) ----------------
  { matchNumber: 97, phase: MatchPhase.CUARTOS, homeTeam: 'Ganador P89', awayTeam: 'Ganador P90', stadium: 'Gillette Stadium', city: 'Foxborough', date: '2026-07-09T16:00:00-04:00' },
  { matchNumber: 98, phase: MatchPhase.CUARTOS, homeTeam: 'Ganador P93', awayTeam: 'Ganador P94', stadium: 'SoFi Stadium', city: 'Inglewood', date: '2026-07-10T12:00:00-07:00' },
  { matchNumber: 99, phase: MatchPhase.CUARTOS, homeTeam: 'Ganador P91', awayTeam: 'Ganador P92', stadium: 'Hard Rock Stadium', city: 'Miami Gardens', date: '2026-07-11T17:00:00-04:00' },
  { matchNumber: 100, phase: MatchPhase.CUARTOS, homeTeam: 'Ganador P95', awayTeam: 'Ganador P96', stadium: 'Arrowhead Stadium', city: 'Kansas City', date: '2026-07-11T20:00:00-05:00' },

  // ---------------- Semifinals (semifinal) ----------------
  { matchNumber: 101, phase: MatchPhase.SEMIFINAL, homeTeam: 'Ganador P97', awayTeam: 'Ganador P98', stadium: 'AT&T Stadium', city: 'Arlington', date: '2026-07-14T14:00:00-05:00' },
  { matchNumber: 102, phase: MatchPhase.SEMIFINAL, homeTeam: 'Ganador P99', awayTeam: 'Ganador P100', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', date: '2026-07-15T15:00:00-04:00' },

  // ---------------- Third place (tercer_puesto) ----------------
  { matchNumber: 103, phase: MatchPhase.TERCER_PUESTO, homeTeam: 'Perdedor P101', awayTeam: 'Perdedor P102', stadium: 'Hard Rock Stadium', city: 'Miami Gardens', date: '2026-07-18T17:00:00-04:00' },

  // ---------------- Final ----------------
  { matchNumber: 104, phase: MatchPhase.FINAL, homeTeam: 'Ganador P101', awayTeam: 'Ganador P102', stadium: 'MetLife Stadium', city: 'East Rutherford', date: '2026-07-19T15:00:00-04:00' },
];
