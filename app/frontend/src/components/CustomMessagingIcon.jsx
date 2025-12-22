// CustomMessagingIcon.jsx - Icône de messagerie personnalisée

export default function CustomMessagingIcon({ className = "w-6 h-6", color = "currentColor" }) {
  return (
    <svg 
      viewBox="80 100 310 280" 
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fill="none" fillRule="evenodd">
        <path 
          fill={color}
          d="M346.25 270.962v-98.628h19.667v97.136c0 25.698-20.833 46.53-46.531 46.53H187.613l-68.022 53.67-12.182-15.44 73.199-57.754.142.218v-.36h140.128c14.013 0 25.372-11.36 25.372-25.372zM131.983 134.667a8.316 8.316 0 0 0-8.316 8.316V301H104V136.748c0-12.011 9.737-21.748 21.748-21.748h240.31l-.283 19.667H131.983z"
        />
      </g>
    </svg>
  );
}
