// CustomLogo.jsx - Votre logo personnalisé

export default function CustomLogo({ className = "w-6 h-6", color = "currentColor" }) {
  return (
    <svg 
      viewBox="0 0 297.87 299.15" 
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path 
        fill={color}
        stroke={color}
        strokeMiterlimit="10"
        d="M164.37,9.74L22.21,117.96l-.31,180.69H.5V114.96c0-3.5,1.64-6.79,4.43-8.89L142.37,2.49c3.45-2.6,8.2-2.66,11.71-.14l10.3,7.38Z"
      />
      <path 
        fill={color}
        stroke={color}
        strokeMiterlimit="10"
        d="M178.44,44.89l96,72.76.51,131.4c.06,15.25-12.22,27.68-27.47,27.81l-192.55,1.6v20.18h198.55c22.61,0,43.72-19.28,43.9-41.89l-1.46-143.13c-.04-4.21-2.07-8.15-5.46-10.63l-96.42-70.65-15.59,12.54Z"
      />
    </svg>
  );
}
