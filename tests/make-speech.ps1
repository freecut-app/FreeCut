Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Maria Desktop')
$s.SetOutputToWaveFile((Join-Path $PSScriptRoot 'media\fala.wav'))
$s.Speak('Olá, bem-vindo ao FreeCut. Este é um teste de legendas automáticas. O editor de vídeo é totalmente gratuito.')
$s.Dispose()
